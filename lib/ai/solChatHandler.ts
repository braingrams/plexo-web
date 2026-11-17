import { buildSolAppContext } from "@/lib/projects/solAppContext";
import { friendlyProviderError } from "@/lib/ai/providerErrors";
import { describeAttachedImages } from "@/lib/ai/solImageDescriptions";
import type { ResolvedUser } from "@/lib/mcp/dispatchMcpTool";
import { maxAnswerTokensFor, solRouteForUser, tierFor, type SolRefusal, type SolRoute } from "@/lib/ai/solEngine";
import { ensureCreditPeriod, chargeUsage, estimateWorstCaseCost, holdCredits, releaseHold } from "@/lib/db/ledgerOperations";
import { turnCreditCeiling } from "@/lib/credits/turnBudget";
import { sumUsageSince } from "@/lib/ai/solTurnUsage";
import { estimateWorstCaseAgentTurnCost } from "@/lib/credits/agentTurnEstimate";
import { SolConversation, SolMessage, SolMemoryFact, SolPreferences } from "@/lib/db/solEntities";
import { bumpConversationActivity } from "@/lib/db/solConversationActivity";
import { isDestructiveTool } from "@/lib/mcp/toolRiskClassification";
import type { AiProvider, ConcreteTier } from "./types";
import {
  runAgentTurn,
  resumeAgentTurn,
  InsufficientCreditsError,
  AgentIterationLimitError,
  type AgentTurnDeps,
  type ResumeAgentTurnDeps,
  type AskUserAnswer,
  type SolPromptPreferences,
} from "./solAgent";
import { ASK_USER_QUESTION_TOOL_NAME } from "./solToolSchema";
import { loadBuildProfile } from "./solBuildContext";
import { withSites } from "./solSiteContext";
import { maybeExtractMemoryFact } from "./memoryExtraction";
import { maybeGenerateConversationTitle } from "./titleGeneration";
import { recordSolUsageEvent, type SolToolCallRecord } from "@/lib/solAnalytics";

// The runtime-agnostic core of a SOL chat turn — everything about a turn EXCEPT how bytes
// actually reach the caller. Originally this all lived directly inside
// lambda/sol-chat/index.ts, coupled to `awslambda.HttpResponseStream`/`NodeJS.WritableStream`
// (the only way a Lambda Function URL can stream). Pulled out here so the exact same
// turn/credit/confirmation/memory logic can ALSO run inside a plain Next.js Route Handler
// (see app/api/v1/sol/chat/conversations/[id]/messages/route.ts) for `next dev`, where no
// Lambda runtime — and therefore no `awslambda` global — exists at all. In a real deployed
// environment, CloudFront routes `api/v1/sol/chat/*` straight to the dedicated streaming
// Lambda before it ever reaches the Next.js app (cdk/lib/compute-stack.ts's CloudFront
// behavior), so the Next.js route is effectively dead code in production — its only job is
// making `next dev` actually work without deploying first.
//
// Both callers commit to a `TurnEmitter` — a tiny abstraction over "write one NDJSON frame"
// / "end the response" — instead of a raw stream type, so this file has zero knowledge of
// Lambda or Next.js specifically.

export type ModelTier = ConcreteTier;
export const VALID_TIERS = new Set<ModelTier>(["BASIC", "MEDIUM", "HIGH"]);

/** The event-vocabulary a SOL chat turn streams as newline-delimited JSON. Field names match
 * solAgent.ts's actual callback payload shapes — e.g. `onToolCallResult` can report status
 * "cancelled" (a declined confirmation's own result), not just success|error. */
export type StreamFrame =
  | { type: "tool_call_preparing"; id: string; name: string; label: string; characters: number }
  | { type: "tool_call_start"; id: string; name: string; label: string; args: unknown }
  | { type: "tool_call_awaiting_confirmation"; id: string; name: string; args: unknown; messageId: string }
  | { type: "tool_call_result"; id: string; name: string; status: "success" | "error" | "cancelled"; result?: unknown }
  | { type: "token"; text: string }
  | { type: "message_done"; messageId: string | null; usage: { inputTokens: number; outputTokens: number } }
  | { type: "title_generated"; title: string }
  | { type: "attachment_described"; url: string; description: string }
  | { type: "credit_exhausted"; requiredCredits: number; availableCredits: number }
  /** A step that was already running when credits ran out finished and took the balance below zero. */
  | { type: "credits_overdrawn"; overdrawnBy: number; balance: number }
  | { type: "error"; message: string };

/** A caller-supplied sink for a streaming turn's output — the one thing that genuinely
 * differs between a Lambda Function URL (wraps `awslambda.HttpResponseStream`) and a Next.js
 * Route Handler (wraps a `ReadableStream` controller). */
export interface TurnEmitter {
  emit: (frame: StreamFrame) => void;
  end: () => void;
}

/** Turns a snake_case MCP tool name into a short human label for the chat UI's tool-call
 * chip — solToolSchema.ts's BedrockToolDef only carries `name`/`description` (no dedicated
 * short title), so this is a lightweight, purely cosmetic derivation, not a lookup. */
export function humanizeToolName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** Fetches a conversation the caller must own — SolConversation's primary key embeds
 * `updatedAt` (see solEntities.ts), so there's no direct `.get({userId, id})`; this queries
 * the user's whole conversation list and finds the match, same "small per-user list, filter
 * in memory" pattern app/api/v1/media/route.ts's DELETE already uses for an analogous
 * problem (UploadedImage's key doesn't include a bare id-lookup index either). */
async function loadOwnedConversation(userId: string, conversationId: string) {
  const { data: conversations } = await SolConversation.query.primary({ userId }).go({ pages: "all" });
  return conversations.find((c) => c.id === conversationId) ?? null;
}

/** Loads both the memory facts to feed into the system prompt AND whether memory is enabled
 * at all — `memoryEnabled: false` and "enabled but zero facts saved" both yield an empty
 * `facts` array, so callers that need to gate something else on the *setting itself* (e.g.
 * whether to attempt automatic memory extraction after this turn) can't infer it from `facts`
 * alone and need `memoryEnabled` explicitly. */
async function loadMemoryContext(userId: string): Promise<{ memoryEnabled: boolean; facts: string[]; preferences: SolPromptPreferences }> {
  const { data: prefs } = await SolPreferences.get({ userId }).go();
  // The owner's tone / length / custom instructions from Settings → SOL, fed into the system prompt.
  const preferences: SolPromptPreferences = { tonePreset: prefs?.tonePreset ?? null, responseLength: prefs?.responseLength ?? null, customInstructions: prefs?.customInstructions ?? null };
  const memoryEnabled = prefs?.memoryEnabled !== false;
  if (!memoryEnabled) return { memoryEnabled: false, facts: [], preferences };
  const { data: facts } = await SolMemoryFact.query.primary({ userId }).go({ pages: "all" });
  return { memoryEnabled: true, facts: facts.map((f) => f.text), preferences };
}


interface SolAiRouting {
  provider: AiProvider;
  apiKey?: string;
  /** True when this turn is billed to the account's own provider key, not Plexo's credit
   * ledger — settleTurn uses this to skip chargeUsage entirely. */
  isByok: boolean;
  route: SolRoute;
  /** The account's plan — Free accounts on Plexo's AI run on Basic (lib/ai/solEngine.ts). */
  plan: string;
}

/** Which provider/key serves this user's SOL turns — the same rules every AI feature uses
 *  (lib/ai/solEngine.ts): their Settings → AI choice, Plexo's system AI otherwise. */
async function resolveSolAiRouting(userId: string): Promise<SolAiRouting | SolRefusal> {
  const resolved = await solRouteForUser(userId);
  if ("error" in resolved) return resolved;
  const { route, plan } = resolved;
  return { provider: route.provider, apiKey: route.apiKey || undefined, isByok: route.paidBy === "own-key", route, plan };
}

/** Finds the most recent user-authored message strictly before `beforeCreatedAt` in an
 * already-fetched transcript and returns its plain text — used to recover "what did the user
 * actually say" for a resumed (post-confirmation) turn, where there's no fresh `text` in the
 * request body the way there is on the initial /messages route. Reuses a transcript the
 * caller already fetched for its own purposes rather than issuing another query. */
function findPrecedingUserText(messages: Array<{ role: string; createdAt: string; content: unknown }>, beforeCreatedAt: string): string {
  const priorUserMessages = messages
    .filter((m) => m.role === "user" && m.createdAt < beforeCreatedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const last = priorUserMessages[0];
  if (!last || !Array.isArray(last.content)) return "";
  return last.content
    .filter((block: any) => block?.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("");
}

async function loadLastMessage(conversationId: string): Promise<{ id: string; createdAt: string } | null> {
  const { data } = await SolMessage.query.primary({ conversationId }).go({ order: "desc", limit: 1 });
  const message = data[0];
  return message ? { id: message.id, createdAt: message.createdAt } : null;
}


/** Fire-and-forget per lib/solAnalytics.ts's own documented convention — a failed analytics
 * write must never affect the real response (already sent/streamed by the time this fires)
 * or mask a real error. */
function recordUsageEventBestEffort(input: Parameters<typeof recordSolUsageEvent>[0]): void {
  void recordSolUsageEvent(input).catch((err) => console.error("Failed to record SOL usage event:", err));
}

/** Content blocks for the new user message as STORED in the transcript: the text plus a
 * URL-sourced block per attachment (with its filename, for the chat UI). These private URLs
 * aren't model-readable as-is — lib/ai/solAttachments.ts swaps them for inline bytes/text
 * right before each model call. A message can be attachments only (an image with no
 * caption), in which case there's no text block: the API rejects empty text blocks.
 * Voice notes never arrive here (they're transcribed to text client-side first). */
function buildUserMessageContent(text: string, attachments: Array<{ type?: string; url?: string; filename?: string }> | undefined): unknown[] {
  const blocks: unknown[] = text ? [{ type: "text", text }] : [];
  for (const attachment of attachments ?? []) {
    if (!attachment?.url) continue;
    const filename = typeof attachment.filename === "string" ? attachment.filename.slice(0, 200) : undefined;
    if (attachment.type === "image") {
      blocks.push({ type: "image", source: { type: "url", url: attachment.url }, filename });
    } else if (attachment.type === "pdf" || attachment.type === "document") {
      blocks.push({ type: "document", source: { type: "url", url: attachment.url }, filename });
    } else {
      console.warn(`buildUserMessageContent: skipping attachment of unsupported type "${attachment.type}"`);
    }
  }
  return blocks;
}

function buildCallbacks(emit: (frame: StreamFrame) => void) {
  const toolCalls: SolToolCallRecord[] = [];
  // One frame when a tool call starts being written, then at most every 500ms.
  const lastPreparingAt = new Map<string, number>();
  const callbacks = {
    onTextDelta: (delta: string) => emit({ type: "token", text: delta }),
    onToolCallPreparing: (progress: { id: string; name: string; characters: number }) => {
      const now = Date.now();
      const last = lastPreparingAt.get(progress.id);
      if (last !== undefined && now - last < 500) return;
      lastPreparingAt.set(progress.id, now);
      emit({ type: "tool_call_preparing", id: progress.id, name: progress.name, label: humanizeToolName(progress.name), characters: progress.characters });
    },
    onToolCallStart: (call: { id: string; name: string; args: unknown }) =>
      emit({ type: "tool_call_start", id: call.id, name: call.name, label: humanizeToolName(call.name), args: call.args }),
    onToolCallAwaitingConfirmation: async (call: { id: string; name: string; args: unknown; messageId: string }) => {
      emit({ type: "tool_call_awaiting_confirmation", id: call.id, name: call.name, args: call.args, messageId: call.messageId });
    },
    onToolCallResult: (result: { id: string; name: string; status: "success" | "error" | "cancelled"; result?: unknown }) => {
      emit({ type: "tool_call_result", id: result.id, name: result.name, status: result.status, result: result.result });
      toolCalls.push({
        name: result.name,
        destructive: isDestructiveTool(result.name),
        confirmed: result.status !== "cancelled",
        executed: result.status === "success",
        errorCode: result.status === "error" ? "tool_error" : undefined,
      });
    },
  };
  return { callbacks, toolCalls };
}

/** Shared tail end of both the fresh-turn and resume-turn paths: given the Promise returned
 * by runAgentTurn/resumeAgentTurn (already wired to emit frames via its callbacks as they
 * fire), finishes the turn correctly for each of the three possible outcomes — a completed
 * answer (charge once, bump conversation bookkeeping, message_done), a paused confirmation
 * (no charge yet), or a mid-loop credit exhaustion (charge the real partial usage,
 * credit_exhausted). Also records a SolUsageEvent analytics row for every outcome except a
 * paused confirmation, which isn't a completed turn yet. */
async function settleTurnBody(
  emitter: TurnEmitter,
  turnPromise: Promise<{ finalText: string; usage: { inputTokens: number; outputTokens: number }; pendingConfirmation?: unknown }>,
  ctx: {
    userId: string;
    /** This turn's credit hold (holdCredits) — dropped in the same write that bills the turn. */
    holdId?: string;
    organizationId: string;
    conversationId: string;
    modelTier: ModelTier;
    /** Which provider actually served this turn — used for the ledger entry (when charged)
     * and the analytics row, instead of the previously-hardcoded "bedrock_claude". */
    provider: AiProvider;
    /** True when this turn is billed to the account's own BYOK key — chargeUsage is
     * skipped entirely in that case, credits are never touched. */
    isByok: boolean;
    turnStartedAt: string;
    approxInputChars: number;
    prompt?: string;
    attachmentCount?: number;
    attachmentTypes?: string[];
    toolCalls: SolToolCallRecord[];
    /** Whether the user has SOL memory enabled at all (SolPreferences.memoryEnabled) — gates
     * automatic post-turn memory extraction entirely. */
    memoryEnabled: boolean;
    /** The user's current SolMemoryFact text, for maybeExtractMemoryFact's dedup context —
     * already loaded once per request to build the system prompt, reused instead of
     * querying again. */
    existingMemoryFacts: string[];
    /** What the user actually said this turn, for memory extraction — the fresh-message
     * route's own request text, or (for a resumed turn) the preceding user message recovered
     * from the transcript. Empty string is a safe no-op default. */
    userTextForMemory: string;
    /** Started (not awaited) by the caller the INSTANT it knows the conversation still has
     * no title — before the main turn even begins, using only the user's own message, not
     * anything the assistant says back. This deliberately does NOT wait for a completed
     * turn: SOL very often pauses immediately (a destructive-confirmation gate, or its own
     * ask_user_question tool) on literally the first message, and a title generated from
     * "I'd like to host a fitness training site" needs no assistant reply at all to be
     * useful — waiting for a full turn meant a conversation could sit on "New conversation"
     * through several question-rounds before ever getting titled. `null` when the
     * conversation already has a title (the common case, every turn after the first). */
    titlePromise: Promise<string | null> | null;
    /** Work that runs alongside the turn and may still send frames (image descriptions) —
     * finished before the stream closes. */
    alongside?: Promise<void> | null;
  },
): Promise<void> {
  const startedAtMs = new Date(ctx.turnStartedAt).getTime();

  // A step that was already running when the credits ran out finishes rather than being cut
  // off (an app left half-built is worse than a small overdraft), so the balance can end up
  // below zero. Say so plainly — the chat shows why, instead of a surprise negative number.
  function noteOverdraft(charged: { overdrawnBy: number; allowanceBalance: number; topupBalance: number } | null | undefined) {
    if (!charged || charged.overdrawnBy <= 0) return;
    emitter.emit({ type: "credits_overdrawn", overdrawnBy: charged.overdrawnBy, balance: charged.allowanceBalance + charged.topupBalance });
  }

  // Runs at every single exit from this function, regardless of outcome — a paused
  // confirmation/question, a completed answer, credit exhaustion, or a hard error all
  // still deserve a shot at surfacing the title the instant it's ready, since the promise
  // was already started up front and may well resolve before any of those outcomes do.
  async function finish() {
    if (ctx.alongside) await ctx.alongside.catch(() => {});
    if (ctx.titlePromise) {
      const title = await ctx.titlePromise;
      if (title) emitter.emit({ type: "title_generated", title });
    }
    emitter.end();
  }

  try {
    const result = await turnPromise;

    if (result.pendingConfirmation) {
      // Already emitted by the onToolCallAwaitingConfirmation callback below — nothing more
      // to send. No chargeUsage, no analytics event: no full turn has completed yet. Still
      // bumped, though: bumpConversationActivity recomputes messageCount/lastMessageAt from
      // the REAL SolMessage rows (the user's message, the assistant's tool_use message, are
      // both already persisted by this point even though the turn paused) — skipping it
      // here left `messageCount` stuck at its creation-time value of 0 for any conversation
      // that pauses on its very first turn, which is exactly what ThreadSidebar's Recents
      // filter (`messageCount > 0 || id === activeConversationId`) uses to decide what's
      // worth listing. A conversation could have a full, real transcript and still be
      // completely invisible in Recents (short of it being the one currently open) until
      // some later turn happened to complete all the way through.
      await bumpConversationActivity(ctx.userId, ctx.conversationId);
      await finish();
      return;
    }

    // BYOK turns are billed to the account's own provider key directly — never touch
    // Plexo's credit ledger for them, same as the page-builder AI feature's own BYOK path.
    let creditsCharged = 0;
    if (!ctx.isByok) {
      const charged = await chargeUsage(ctx.userId, {
        provider: ctx.provider,
        tier: ctx.modelTier,
        mode: "agent_chat",
        usage: result.usage,
        releaseHoldId: ctx.holdId,
      });
      creditsCharged = charged.creditsCharged;
      noteOverdraft(charged);
    }

    await bumpConversationActivity(ctx.userId, ctx.conversationId);

    const lastMessage = await loadLastMessage(ctx.conversationId);
    emitter.emit({ type: "message_done", messageId: lastMessage?.id ?? null, usage: result.usage });
    await finish();

    // Background bookkeeping only — this is a genuinely finished exchange (past the
    // `pendingConfirmation` early-return above), so it's safe to let SOL notice a durable
    // fact/preference and save it for next time. Fire-and-forget: never awaited, never
    // allowed to delay a response the user already received.
    if (ctx.memoryEnabled) {
      void maybeExtractMemoryFact({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        userText: ctx.userTextForMemory,
        assistantText: result.finalText,
        existingFacts: ctx.existingMemoryFacts,
      }).catch((err) => console.error("maybeExtractMemoryFact failed:", err));
    }

    // `id`/`createdAt` pinned to the final assistant SolMessage's own — lets a later feedback
    // PATCH find this row with zero extra lookup, keyed only on the SolMessage id it already
    // has.
    recordUsageEventBestEffort({
      id: lastMessage?.id,
      createdAt: lastMessage?.createdAt,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      provider: ctx.provider,
      tier: ctx.modelTier,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      creditsCharged,
      latencyMs: Date.now() - startedAtMs,
      outcome: "success",
      toolCalls: ctx.toolCalls,
      attachmentCount: ctx.attachmentCount,
      attachmentTypes: ctx.attachmentTypes,
      prompt: ctx.prompt,
      response: result.finalText,
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      const partialUsage = await sumUsageSince(ctx.conversationId, ctx.turnStartedAt);
      let creditsCharged = 0;
      if (partialUsage.inputTokens > 0 || partialUsage.outputTokens > 0) {
        const charged = await chargeUsage(ctx.userId, {
          provider: ctx.provider,
          tier: ctx.modelTier,
          mode: "agent_chat",
          usage: partialUsage,
          releaseHoldId: ctx.holdId,
        }).catch((chargeErr) => {
          console.error("settleTurn: failed to charge partial usage after credit exhaustion:", chargeErr);
          return null;
        });
        creditsCharged = charged?.creditsCharged ?? 0;
        noteOverdraft(charged);
      }
      await bumpConversationActivity(ctx.userId, ctx.conversationId).catch(() => {});

      const requiredCredits = estimateWorstCaseCost(ctx.provider, ctx.modelTier, "agent_chat", ctx.approxInputChars);
      const balance = await ensureCreditPeriod(ctx.userId);
      emitter.emit({ type: "credit_exhausted", requiredCredits, availableCredits: balance.total });
      await finish();

      recordUsageEventBestEffort({
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        provider: ctx.provider,
        tier: ctx.modelTier,
        inputTokens: partialUsage.inputTokens,
        outputTokens: partialUsage.outputTokens,
        creditsCharged,
        latencyMs: Date.now() - startedAtMs,
        outcome: "error",
        errorCode: "insufficient_credits",
        toolCalls: ctx.toolCalls,
        attachmentCount: ctx.attachmentCount,
        attachmentTypes: ctx.attachmentTypes,
        prompt: ctx.prompt,
      });
      return;
    }

    // Our own errors are already written for people; a provider's (a 400 about tool_use
    // ids, a 529…) is reworded — the detail goes to the logs below, not the chat.
    const message =
      err instanceof AgentIterationLimitError
        ? err.message
        : (err as { status?: number })?.status
          ? `SOL couldn't answer that: ${friendlyProviderError(err)}`
          : err instanceof Error
            ? err.message
            : "SOL hit an unexpected error. Try sending your message again.";
    console.error("SOL chat turn failed:", err);
    // The rounds that ran before the failure did real work (their results are saved) and are
    // charged like any other — a turn that stopped partway used to cost nothing at all. A
    // model call that itself failed has no usage, so it's never charged.
    const partialUsage = await sumUsageSince(ctx.conversationId, ctx.turnStartedAt).catch(() => ({ inputTokens: 0, outputTokens: 0 }));
    let creditsCharged = 0;
    // Own-key accounts are billed by their provider, never in credits.
    if (!ctx.isByok && (partialUsage.inputTokens > 0 || partialUsage.outputTokens > 0)) {
      const charged = await chargeUsage(ctx.userId, { provider: ctx.provider, tier: ctx.modelTier, mode: "agent_chat", usage: partialUsage, releaseHoldId: ctx.holdId }).catch((chargeErr) => {
        console.error("settleTurn: failed to charge the rounds that ran before an error:", chargeErr);
        return null;
      });
      creditsCharged = charged?.creditsCharged ?? 0;
      noteOverdraft(charged);
    }
    // Same reasoning as the pendingConfirmation branch above: the user's own message (at
    // minimum) was already persisted before this failed, so messageCount is stale without
    // this — best-effort, never worth failing the error response itself over.
    await bumpConversationActivity(ctx.userId, ctx.conversationId).catch(() => {});
    emitter.emit({ type: "error", message });
    await finish();

    recordUsageEventBestEffort({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      provider: ctx.provider,
      tier: ctx.modelTier,
      inputTokens: partialUsage.inputTokens,
      outputTokens: partialUsage.outputTokens,
      creditsCharged,
      latencyMs: Date.now() - startedAtMs,
      outcome: err instanceof AgentIterationLimitError ? "timeout" : "error",
      errorCode: err instanceof Error ? err.name : "unknown",
      toolCalls: ctx.toolCalls,
      attachmentCount: ctx.attachmentCount,
      attachmentTypes: ctx.attachmentTypes,
      prompt: ctx.prompt,
    });
  }
}

/**
 * Settles a turn and — whatever happened — makes sure its credit hold is gone afterwards: billing
 * releases it in the same write, but a turn that paused for a confirmation, or had nothing to
 * bill, still has to let go. (A hold nobody releases would expire on its own, but not instantly.)
 */
async function settleTurn(...args: Parameters<typeof settleTurnBody>): Promise<void> {
  const [, , ctx] = args;
  try {
    await settleTurnBody(...args);
  } finally {
    if (ctx.holdId && !ctx.isByok) await releaseHold(ctx.userId, ctx.holdId).catch((err) => console.error("settleTurn: couldn't release the credit hold:", err));
  }
}

/**
 * A one-line description under each image the user attached (lib/ai/solImageDescriptions.ts):
 * sent to the chat as soon as it's ready, saved onto the user's message so it's there when
 * the chat is reopened (or shared), and charged as SOL usage — to the account's own key for
 * BYOK, which Plexo's credits never touch.
 */
async function describeImagesAlongside(params: {
  userId: string;
  conversationId: string;
  routing: { provider: AiProvider; apiKey?: string; isByok: boolean };
  content: unknown[];
  savedKey: Promise<{ id: string; createdAt: string } | null>;
  emit: (frame: StreamFrame) => void;
}): Promise<void> {
  const urls = (params.content as Array<{ type?: string; source?: { url?: string } }>)
    .filter((b) => b?.type === "image" && typeof b.source?.url === "string")
    .map((b) => b.source!.url!);
  if (urls.length === 0) return;
  const { byUrl, usage } = await describeAttachedImages({ userId: params.userId, provider: params.routing.provider, apiKey: params.routing.apiKey, urls });
  if (!params.routing.isByok && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
    await chargeUsage(params.userId, { provider: params.routing.provider, tier: "BASIC", mode: "agent_chat", usage }).catch((err) =>
      console.error("[sol] couldn't charge for image descriptions:", err),
    );
  }
  if (byUrl.size === 0) return;
  for (const [url, description] of byUrl) params.emit({ type: "attachment_described", url, description });
  const key = await params.savedKey;
  if (!key) return;
  const content = (params.content as Array<{ type?: string; source?: { url?: string } }>).map((b) =>
    b?.type === "image" && b.source?.url && byUrl.has(b.source.url) ? { ...b, description: byUrl.get(b.source.url) } : b,
  );
  await SolMessage.patch({ conversationId: params.conversationId, createdAt: key.createdAt, id: key.id })
    .set({ content })
    .go()
    .catch((err) => console.error("[sol] couldn't save image descriptions:", err));
}

/** A turn that hasn't started streaming yet — either it already failed a pre-flight check
 * (`ok: false`, respond with plain JSON at `status`) or it's ready to go (`ok: true`, call
 * `run(emitter)` once the caller has its own streaming response committed). Splitting
 * "decide" from "stream" like this is what lets a Lambda (which must wrap its raw
 * `HttpResponseStream` differently for a JSON error vs. an NDJSON stream) and a Next.js Route
 * Handler (which must choose between returning `NextResponse.json(...)` vs. a streaming
 * `Response` before it can write anything) both drive the exact same turn logic. */
export type PreparedTurn = { ok: false; status: number; body: unknown } | { ok: true; run: (emitter: TurnEmitter) => Promise<void> };

export async function prepareMessagesTurn(
  conversationId: string,
  resolved: ResolvedUser,
  body: unknown,
): Promise<PreparedTurn> {
  const parsed = body as { text?: string; attachments?: Array<{ type?: string; url?: string; filename?: string }>; modelTier?: string; siteId?: string; siteChosen?: boolean; siteHintId?: string };
  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  let modelTier = parsed.modelTier as ModelTier;
  const hasAttachments = Array.isArray(parsed.attachments) && parsed.attachments.some((a) => a?.url);

  // An image sent with no caption is a perfectly normal message ("what do you think of this?").
  if ((!text && !hasAttachments) || !VALID_TIERS.has(modelTier)) {
    return { ok: false, status: 400, body: { error: "Type a message or attach a file, and pick a valid `modelTier` (BASIC|MEDIUM|HIGH)." } };
  }

  const conversation = await loadOwnedConversation(resolved.userId, conversationId);
  if (!conversation) {
    return { ok: false, status: 404, body: { error: "Conversation not found." } };
  }

  const routing = await resolveSolAiRouting(resolved.userId);
  if ("error" in routing) return { ok: false, status: routing.status, body: { error: routing.error } };
  // Free accounts on Plexo's AI run on Basic — the same rule as every AI feature (solEngine).
  modelTier = tierFor(routing.route, routing.plan, modelTier as ConcreteTier) as ModelTier;

  // BYOK turns are billed to the account's own provider key directly — Plexo's credit
  // balance is never consulted for them, so this pre-flight check (and the mid-loop
  // budgetGuard below) only applies to System AI turns.
  if (!routing.isByok) {
    const requiredCredits = estimateWorstCaseAgentTurnCost(modelTier, text.length, maxAnswerTokensFor(routing.route, routing.plan));
    const preflightBalance = await ensureCreditPeriod(resolved.userId);
    if (preflightBalance.available < requiredCredits) {
      return { ok: false, status: 402, body: { error: "insufficient_credits", requiredCredits, availableCredits: Math.max(0, preflightBalance.available) } };
    }
  }

  const { memoryEnabled, facts: memoryFacts, preferences } = await loadMemoryContext(resolved.userId);
  const explicitSiteId = parsed.siteChosen === true && typeof parsed.siteId === "string" ? parsed.siteId : undefined;
  const hintSiteId = typeof parsed.siteHintId === "string" ? parsed.siteHintId : undefined;
  const buildProfile = await withSites(await loadBuildProfile(resolved.userId), resolved.organizationId, { explicitSiteId, boundSiteId: conversation.siteId ?? undefined, hintSiteId });
  // A site the owner chose in this chat sticks to it, so later turns never ask again (only a real site of theirs counts).
  if (explicitSiteId && explicitSiteId !== conversation.siteId && buildProfile?.sites?.some((s) => s.id === explicitSiteId)) {
    await bumpConversationActivity(resolved.userId, conversationId, { siteId: explicitSiteId }).catch((err) => console.error("binding the chat to a site failed", err));
  }
  const turnStartedAt = new Date().toISOString();
  // Started here, immediately, NOT inside `run` below — this needs to begin running in
  // parallel with the main turn as early as possible, using only `text` (the user's own
  // fresh message), regardless of whether that turn goes on to complete, pause, or fail.
  // See settleTurn's own `titlePromise` doc comment for why this can't wait for a
  // completed turn the way it originally did.
  const titlePromise = conversation.title ? null : maybeGenerateConversationTitle({
    userId: resolved.userId,
    conversationId,
    userText: text || "Shared a file for SOL to look at",
    assistantText: "",
  });

  return {
    ok: true,
    run: async (emitter) => {
      const { callbacks, toolCalls } = buildCallbacks(emitter.emit);
      const userMessageContent = buildUserMessageContent(text, parsed.attachments);
      let userMessageSaved: (key: { id: string; createdAt: string } | null) => void = () => {};
      const savedKey = new Promise<{ id: string; createdAt: string } | null>((resolve) => {
        userMessageSaved = resolve;
      });
      const alongside = describeImagesAlongside({
        userId: resolved.userId,
        conversationId,
        routing,
        content: userMessageContent,
        savedKey,
        emit: emitter.emit,
      });
      // One hold per run of a turn (a resumed turn after a confirmation gets its own) — see holdCredits.
      const holdId = crypto.randomUUID();
      const deps: AgentTurnDeps = {
        conversationId,
        resolvedUser: resolved,
        modelTier,
        provider: routing.provider,
        apiKey: routing.apiKey,
        userMessageContent,
        memoryFacts,
        preferences,
        buildProfile,
        appContext: conversation.appId ? await buildSolAppContext(conversation.appId, resolved).catch(() => undefined) : undefined,
        boundAppId: conversation.appId ?? undefined,
        ...callbacks,
        onUserMessageSaved: (key) => userMessageSaved(key),
        // Re-checked before EVERY loop iteration, not just once up front — a long
        // tool-using turn can, in principle, exhaust credits the generous up-front
        // worst-case estimate still passed. Always true for BYOK — see the pre-flight
        // check above.
        maxOutputTokens: maxAnswerTokensFor(routing.route, routing.plan),
        budgetGuard: routing.isByok
          ? async () => true
          : async (progress) => {
              // Holds the most this turn could still bill (what it has used so far + the next step's
              // worst case — lib/credits/turnBudget.ts) against the account's FREE credits, i.e. after every
              // other running chat's hold too. If it can't be held, the turn stops before the step.
              await ensureCreditPeriod(resolved.userId);
              const ceiling = turnCreditCeiling({ provider: routing.provider, tier: modelTier, progress, maxOutputTokens: maxAnswerTokensFor(routing.route, routing.plan) });
              return (await holdCredits(resolved.userId, holdId, ceiling)).held;
            },
      };

      const turn = runAgentTurn(deps);
      // A turn that failed before saving the message has nothing to add descriptions to.
      void turn.then(() => userMessageSaved(null), () => userMessageSaved(null));
      await settleTurn(emitter, turn, {
        userId: resolved.userId,
        holdId,
        organizationId: resolved.organizationId,
        conversationId,
        modelTier,
        provider: routing.provider,
        isByok: routing.isByok,
        turnStartedAt,
        approxInputChars: text.length,
        prompt: text,
        attachmentCount: parsed.attachments?.length ?? 0,
        attachmentTypes: (parsed.attachments ?? []).map((a) => a.type).filter((t): t is string => Boolean(t)),
        toolCalls,
        memoryEnabled,
        existingMemoryFacts: memoryFacts,
        userTextForMemory: text,
        titlePromise,
        alongside,
      });
    },
  };
}

export async function prepareConfirmTurn(
  conversationId: string,
  messageId: string,
  resolved: ResolvedUser,
  body: unknown,
): Promise<PreparedTurn> {
  const parsed = body as { decision?: string; answers?: Array<{ question?: string; answer?: string }> };

  const conversation = await loadOwnedConversation(resolved.userId, conversationId);
  if (!conversation) {
    return { ok: false, status: 404, body: { error: "Conversation not found." } };
  }

  // The confirm route's {messageId} path param is the PENDING SolMessage row's own `id`
  // (what runAgentTurn's `pendingConfirmation.messageId` reported to the client that
  // originally streamed it) — not the same as the Anthropic tool_use id resumeAgentTurn
  // actually keys off of (`pendingConfirmation.toolCallId`). Recover the latter from the
  // stored message's own content blocks.
  const { data: messages } = await SolMessage.query.primary({ conversationId }).go({ pages: "all" });
  const pendingMessage = messages.find((m) => m.id === messageId && m.confirmationState === "PENDING");
  if (!pendingMessage) {
    return { ok: false, status: 404, body: { error: "No pending confirmation found for this message." } };
  }
  const toolUseBlock = Array.isArray(pendingMessage.content)
    ? (pendingMessage.content.find((block: { type?: string; id?: string; name?: string; input?: unknown }) => block?.type === "tool_use") as
        | { type?: string; id?: string; name?: string; input?: unknown }
        | undefined)
    : undefined;
  const toolCallId = toolUseBlock?.id;
  if (!toolCallId) {
    return { ok: false, status: 500, body: { error: "Pending confirmation message has no tool_use block." } };
  }

  // Two different shapes resume through this same route, distinguished by which tool is
  // actually pending: SOL's own ask_user_question meta-tool takes structured `answers`,
  // every real (destructive) MCP tool takes a plain confirm/decline `decision` — see
  // solAgent.ts's resumeAgentTurn for where both are actually consumed.
  const isAnswerResume = toolUseBlock?.name === ASK_USER_QUESTION_TOOL_NAME;
  let decision: "confirmed" | "declined" | undefined;
  let answers: AskUserAnswer[] | undefined;
  if (isAnswerResume) {
    if (!Array.isArray(parsed.answers) || parsed.answers.length === 0) {
      return { ok: false, status: 400, body: { error: "`answers` (a non-empty array) is required to resume this question." } };
    }
    answers = parsed.answers.map((a) => ({ question: String(a.question ?? ""), answer: String(a.answer ?? "") }));
  } else {
    if (parsed.decision !== "confirmed" && parsed.decision !== "declined") {
      return { ok: false, status: 400, body: { error: '`decision` must be "confirmed" or "declined".' } };
    }
    decision = parsed.decision;
  }

  const routing = await resolveSolAiRouting(resolved.userId);
  if ("error" in routing) return { ok: false, status: routing.status, body: { error: routing.error } };
  const modelTier = tierFor(routing.route, routing.plan, ((conversation.modelTier as ModelTier) ?? "BASIC") as ConcreteTier) as ModelTier;
  await ensureCreditPeriod(resolved.userId);
  const { memoryEnabled, facts: memoryFacts, preferences } = await loadMemoryContext(resolved.userId);
  const buildProfile = await withSites(await loadBuildProfile(resolved.userId), resolved.organizationId, { boundSiteId: conversation.siteId ?? undefined });
  const userTextForMemory = findPrecedingUserText(messages, pendingMessage.createdAt);
  const turnStartedAt = new Date().toISOString();
  // Almost always a no-op by the time a resume happens — the first turn's own
  // prepareMessagesTurn already started (and settleTurn's `finish` already awaited) this
  // exact thing, so `conversation.title` is normally already set. Kept here too, self-
  // healing style (same spirit as bumpConversationActivity re-deriving its own state every
  // call), purely as a backstop for the rare case the first attempt genuinely failed.
  const titlePromise = conversation.title
    ? null
    : maybeGenerateConversationTitle({ userId: resolved.userId, conversationId, userText: userTextForMemory, assistantText: "" });
  // Same conservative estimate basis as the fresh-turn route's budgetGuard — there's no new
  // user-authored text on a resume, so the tool call's own args length is the closest
  // available signal, itself already dwarfed in practice by the full conversation history
  // every call resends.
  const approxInputChars = JSON.stringify(toolUseBlock?.input ?? {}).length;

  return {
    ok: true,
    run: async (emitter) => {
      const { callbacks, toolCalls } = buildCallbacks(emitter.emit);
      const holdId = crypto.randomUUID();
      const deps: ResumeAgentTurnDeps = {
        conversationId,
        resolvedUser: resolved,
        modelTier,
        provider: routing.provider,
        apiKey: routing.apiKey,
        toolCallId,
        decision,
        answers,
        memoryFacts,
        preferences,
        buildProfile,
        appContext: conversation.appId ? await buildSolAppContext(conversation.appId, resolved).catch(() => undefined) : undefined,
        boundAppId: conversation.appId ?? undefined,
        ...callbacks,
        maxOutputTokens: maxAnswerTokensFor(routing.route, routing.plan),
        budgetGuard: routing.isByok
          ? async () => true
          : async (progress) => {
              // Holds the most this turn could still bill (what it has used so far + the next step's
              // worst case — lib/credits/turnBudget.ts) against the account's FREE credits, i.e. after every
              // other running chat's hold too. If it can't be held, the turn stops before the step.
              await ensureCreditPeriod(resolved.userId);
              const ceiling = turnCreditCeiling({ provider: routing.provider, tier: modelTier, progress, maxOutputTokens: maxAnswerTokensFor(routing.route, routing.plan) });
              return (await holdCredits(resolved.userId, holdId, ceiling)).held;
            },
      };

      await settleTurn(emitter, resumeAgentTurn(deps), {
        userId: resolved.userId,
        holdId,
        provider: routing.provider,
        isByok: routing.isByok,
        organizationId: resolved.organizationId,
        conversationId,
        modelTier,
        turnStartedAt,
        approxInputChars,
        toolCalls,
        memoryEnabled,
        existingMemoryFacts: memoryFacts,
        userTextForMemory,
        titlePromise,
      });
    },
  };
}
