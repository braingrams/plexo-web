import type { ResolvedUser } from "@/lib/mcp/dispatchMcpTool";
import { ensureCreditPeriod, chargeUsage, estimateWorstCaseCost } from "@/lib/db/ledgerOperations";
import { estimateWorstCaseAgentTurnCost } from "@/lib/credits/agentTurnEstimate";
import { SolConversation, SolMessage, SolMemoryFact, SolPreferences } from "@/lib/db/solEntities";
import { bumpConversationActivity } from "@/lib/db/solConversationActivity";
import { isDestructiveTool } from "@/lib/mcp/toolRiskClassification";
import type { ConcreteTier } from "./types";
import {
  runAgentTurn,
  resumeAgentTurn,
  InsufficientCreditsError,
  AgentIterationLimitError,
  type AgentTurnDeps,
  type ResumeAgentTurnDeps,
  type AskUserAnswer,
} from "./solAgent";
import { ASK_USER_QUESTION_TOOL_NAME } from "./solToolSchema";
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
  | { type: "tool_call_start"; id: string; name: string; label: string; args: unknown }
  | { type: "tool_call_awaiting_confirmation"; id: string; name: string; args: unknown; messageId: string }
  | { type: "tool_call_result"; id: string; name: string; status: "success" | "error" | "cancelled"; result?: unknown }
  | { type: "token"; text: string }
  | { type: "message_done"; messageId: string | null; usage: { inputTokens: number; outputTokens: number } }
  | { type: "title_generated"; title: string }
  | { type: "credit_exhausted"; requiredCredits: number; availableCredits: number }
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
async function loadMemoryContext(userId: string): Promise<{ memoryEnabled: boolean; facts: string[] }> {
  const { data: prefs } = await SolPreferences.get({ userId }).go();
  const memoryEnabled = prefs?.memoryEnabled !== false;
  if (!memoryEnabled) return { memoryEnabled: false, facts: [] };
  const { data: facts } = await SolMemoryFact.query.primary({ userId }).go({ pages: "all" });
  return { memoryEnabled: true, facts: facts.map((f) => f.text) };
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

/** Sums the usage of every SolMessage persisted in this conversation at or after `sinceIso` —
 * used to recover "how much was actually consumed" when InsufficientCreditsError aborts a
 * turn mid-loop. solAgent.ts's continueLoop persists each assistant message (with its real
 * `usage`) BEFORE the next iteration's budgetGuard check can throw, but the thrown error
 * itself carries no usage payload — so the persisted rows are the only source of truth for
 * what to actually charge for. */
async function sumUsageSince(conversationId: string, sinceIso: string): Promise<{ inputTokens: number; outputTokens: number }> {
  const { data: messages } = await SolMessage.query.primary({ conversationId }).go({ order: "desc", limit: 20 });
  let inputTokens = 0;
  let outputTokens = 0;
  for (const message of messages) {
    if (message.createdAt < sinceIso) break; // chronological desc — everything after this predates the turn
    if (message.role === "assistant" && message.usage) {
      inputTokens += message.usage.inputTokens ?? 0;
      outputTokens += message.usage.outputTokens ?? 0;
    }
  }
  return { inputTokens, outputTokens };
}

/** Fire-and-forget per lib/solAnalytics.ts's own documented convention — a failed analytics
 * write must never affect the real response (already sent/streamed by the time this fires)
 * or mask a real error. */
function recordUsageEventBestEffort(input: Parameters<typeof recordSolUsageEvent>[0]): void {
  void recordSolUsageEvent(input).catch((err) => console.error("Failed to record SOL usage event:", err));
}

/** Bedrock/Anthropic content blocks for the new user message: plain text plus any
 * attachments. Anthropic's Messages API supports a `source: {type: "url", url}` form for
 * both image and document content blocks, letting the model fetch the file itself instead of
 * downloading/base64-encoding it here — the simplest correct option given attachments here
 * are already-hosted URLs (from app/api/v1/sol/upload/route.ts's presigned-POST flow), not
 * raw bytes in the request body. Anything that isn't an image/document (e.g. a voice-note
 * attachment, transcribed to plain text client-side before it's ever sent here) is skipped
 * with a warning rather than guessed at. */
function buildUserMessageContent(text: string, attachments: Array<{ type?: string; url?: string }> | undefined): unknown[] {
  const blocks: unknown[] = [{ type: "text", text }];
  for (const attachment of attachments ?? []) {
    if (!attachment?.url) continue;
    if (attachment.type === "image") {
      blocks.push({ type: "image", source: { type: "url", url: attachment.url } });
    } else if (attachment.type === "pdf" || attachment.type === "document") {
      blocks.push({ type: "document", source: { type: "url", url: attachment.url } });
    } else {
      console.warn(`buildUserMessageContent: skipping attachment of unsupported type "${attachment.type}"`);
    }
  }
  return blocks;
}

function buildCallbacks(emit: (frame: StreamFrame) => void) {
  const toolCalls: SolToolCallRecord[] = [];
  const callbacks = {
    onTextDelta: (delta: string) => emit({ type: "token", text: delta }),
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
async function settleTurn(
  emitter: TurnEmitter,
  turnPromise: Promise<{ finalText: string; usage: { inputTokens: number; outputTokens: number }; pendingConfirmation?: unknown }>,
  ctx: {
    userId: string;
    organizationId: string;
    conversationId: string;
    modelTier: ModelTier;
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
  },
): Promise<void> {
  const startedAtMs = new Date(ctx.turnStartedAt).getTime();

  // Runs at every single exit from this function, regardless of outcome — a paused
  // confirmation/question, a completed answer, credit exhaustion, or a hard error all
  // still deserve a shot at surfacing the title the instant it's ready, since the promise
  // was already started up front and may well resolve before any of those outcomes do.
  async function finish() {
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

    const { creditsCharged } = await chargeUsage(ctx.userId, {
      provider: "bedrock_claude",
      tier: ctx.modelTier,
      mode: "agent_chat",
      usage: result.usage,
    });

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
      provider: "bedrock_claude",
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
          provider: "bedrock_claude",
          tier: ctx.modelTier,
          mode: "agent_chat",
          usage: partialUsage,
        }).catch((chargeErr) => {
          console.error("settleTurn: failed to charge partial usage after credit exhaustion:", chargeErr);
          return null;
        });
        creditsCharged = charged?.creditsCharged ?? 0;
      }
      await bumpConversationActivity(ctx.userId, ctx.conversationId).catch(() => {});

      const requiredCredits = estimateWorstCaseCost("bedrock_claude", ctx.modelTier, "agent_chat", ctx.approxInputChars);
      const balance = await ensureCreditPeriod(ctx.userId);
      emitter.emit({ type: "credit_exhausted", requiredCredits, availableCredits: balance.total });
      await finish();

      recordUsageEventBestEffort({
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        provider: "bedrock_claude",
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

    const message = err instanceof AgentIterationLimitError || err instanceof Error ? err.message : "SOL hit an unexpected error.";
    console.error("SOL chat turn failed:", err);
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
      provider: "bedrock_claude",
      tier: ctx.modelTier,
      inputTokens: 0,
      outputTokens: 0,
      creditsCharged: 0,
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
  const parsed = body as { text?: string; attachments?: Array<{ type?: string; url?: string }>; modelTier?: string };
  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  const modelTier = parsed.modelTier as ModelTier;

  if (!text || !VALID_TIERS.has(modelTier)) {
    return { ok: false, status: 400, body: { error: "A non-empty `text` and a valid `modelTier` (BASIC|MEDIUM|HIGH) are required." } };
  }

  const conversation = await loadOwnedConversation(resolved.userId, conversationId);
  if (!conversation) {
    return { ok: false, status: 404, body: { error: "Conversation not found." } };
  }

  const requiredCredits = estimateWorstCaseAgentTurnCost(modelTier, text.length);
  const preflightBalance = await ensureCreditPeriod(resolved.userId);
  if (preflightBalance.total < requiredCredits) {
    return { ok: false, status: 402, body: { error: "insufficient_credits", requiredCredits, availableCredits: preflightBalance.total } };
  }

  const { memoryEnabled, facts: memoryFacts } = await loadMemoryContext(resolved.userId);
  const turnStartedAt = new Date().toISOString();
  // Started here, immediately, NOT inside `run` below — this needs to begin running in
  // parallel with the main turn as early as possible, using only `text` (the user's own
  // fresh message), regardless of whether that turn goes on to complete, pause, or fail.
  // See settleTurn's own `titlePromise` doc comment for why this can't wait for a
  // completed turn the way it originally did.
  const titlePromise = conversation.title ? null : maybeGenerateConversationTitle({
    userId: resolved.userId,
    conversationId,
    userText: text,
    assistantText: "",
  });

  return {
    ok: true,
    run: async (emitter) => {
      const { callbacks, toolCalls } = buildCallbacks(emitter.emit);
      const deps: AgentTurnDeps = {
        conversationId,
        resolvedUser: resolved,
        modelTier,
        userMessageContent: buildUserMessageContent(text, parsed.attachments),
        memoryFacts,
        ...callbacks,
        // Re-checked before EVERY loop iteration, not just once up front — a long
        // tool-using turn can, in principle, exhaust credits the generous up-front
        // worst-case estimate still passed.
        budgetGuard: async () => {
          const balance = await ensureCreditPeriod(resolved.userId);
          const perCallEstimate = estimateWorstCaseCost("bedrock_claude", modelTier, "agent_chat", text.length);
          return balance.total >= perCallEstimate;
        },
      };

      await settleTurn(emitter, runAgentTurn(deps), {
        userId: resolved.userId,
        organizationId: resolved.organizationId,
        conversationId,
        modelTier,
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

  const modelTier = (conversation.modelTier as ModelTier) ?? "BASIC";
  await ensureCreditPeriod(resolved.userId);
  const { memoryEnabled, facts: memoryFacts } = await loadMemoryContext(resolved.userId);
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
      const deps: ResumeAgentTurnDeps = {
        conversationId,
        resolvedUser: resolved,
        modelTier,
        toolCallId,
        decision,
        answers,
        memoryFacts,
        ...callbacks,
        budgetGuard: async () => {
          const balance = await ensureCreditPeriod(resolved.userId);
          const perCallEstimate = estimateWorstCaseCost("bedrock_claude", modelTier, "agent_chat", approxInputChars);
          return balance.total >= perCallEstimate;
        },
      };

      await settleTurn(emitter, resumeAgentTurn(deps), {
        userId: resolved.userId,
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
