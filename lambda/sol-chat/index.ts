import type { APIGatewayProxyEventV2 } from "aws-lambda";

import {
  runAgentTurn,
  resumeAgentTurn,
  InsufficientCreditsError,
  AgentIterationLimitError,
  type AgentTurnDeps,
  type ResumeAgentTurnDeps,
} from "@/lib/ai/solAgent";
import { ensureCreditPeriod, chargeUsage, estimateWorstCaseCost } from "@/lib/db/ledgerOperations";
import { estimateWorstCaseAgentTurnCost } from "@/lib/credits/agentTurnEstimate";
import { SolConversation, SolMessage, SolMemoryFact, SolPreferences } from "@/lib/db/solEntities";
import { bumpConversationActivity } from "@/lib/db/solConversationActivity";
import { isDestructiveTool } from "@/lib/mcp/toolRiskClassification";
import { maybeExtractMemoryFact } from "@/lib/ai/memoryExtraction";
import { recordSolUsageEvent, type SolToolCallRecord } from "@/lib/solAnalytics";
import { resolveSessionUser, parseCookies, type LambdaResolvedUser } from "./sessionAuth";
import type { ConcreteTier } from "@/lib/ai/types";

// SOL chat-turn Lambda handler, behind a Function URL with `invokeMode: RESPONSE_STREAM`
// (cdk/lib/compute-stack.ts's `solChatFn.addFunctionUrl`). A plain `handler: async (event)
// => ({...})` return-value handler CANNOT stream — Lambda buffers its entire return value
// and delivers it as one response only once the invocation finishes, regardless of the
// Function URL's invoke mode. The correct mechanism for an incrementally-flushed response
// from a Function URL (confirmed against AWS's own "Introducing AWS Lambda response
// streaming" announcement and the Node.js runtime's own documented contract — this is NOT
// an npm package, it's a global the Node 18+ Lambda runtime injects into the execution
// environment only when the function's invoke mode is RESPONSE_STREAM) is exactly what
// @types/aws-lambda's own handler.d.ts documents: wrap the handler in
// `awslambda.streamifyResponse(async (event, responseStream, context) => {...})`, then
// write to `responseStream` (after wrapping it with `awslambda.HttpResponseStream.from(...,
// {statusCode, headers})` to set the status/headers Lambda would otherwise default to
// 200/none) as data becomes available. This is the same mechanism API Gateway's own docs
// point to for a Function URL specifically (as opposed to an ALB or CloudFront-to-Lambda@
// Edge integration, which have their own, different streaming stories) — there is no
// alternative streaming API for a bare Function URL. The `awslambda` global itself (both
// `streamifyResponse` and `HttpResponseStream`) is typed by @types/aws-lambda's own
// handler.d.ts (a `declare global { namespace awslambda {...} } }` block) — already a
// dependency of this repo, no local ambient declaration needed here.

type ModelTier = ConcreteTier;
const VALID_TIERS = new Set<ModelTier>(["BASIC", "MEDIUM", "HIGH"]);

// The event-vocabulary this handler streams as newline-delimited JSON. Field names match
// solAgent.ts's actual callback payload shapes (see lib/ai/solAgent.ts's AgentTurnDeps)
// rather than this task's own initial sketch where the two differ — e.g. solAgent's
// onToolCallResult can report status "cancelled" (a declined confirmation's sibling
// non-destructive calls never hit this, but a declined destructive call's OWN result does),
// which the sketch's success|error union omitted.
type StreamFrame =
  | { type: "tool_call_start"; id: string; name: string; label: string; args: unknown }
  | { type: "tool_call_awaiting_confirmation"; id: string; name: string; args: unknown }
  | { type: "tool_call_result"; id: string; name: string; status: "success" | "error" | "cancelled"; result?: unknown }
  | { type: "token"; text: string }
  | { type: "message_done"; messageId: string | null; usage: { inputTokens: number; outputTokens: number } }
  | { type: "credit_exhausted"; requiredCredits: number; availableCredits: number }
  | { type: "error"; message: string };

function writeFrame(stream: NodeJS.WritableStream, frame: StreamFrame): void {
  stream.write(`${JSON.stringify(frame)}\n`);
}

/** Turns a snake_case MCP tool name into a short human label for the chat UI's tool-call
 * chip — solToolSchema.ts's BedrockToolDef only carries `name`/`description` (no dedicated
 * short title), so this is a lightweight, purely cosmetic derivation, not a lookup. */
function humanizeToolName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

// `awslambda.HttpResponseStream.from()`'s first parameter is typed (by @types/aws-lambda)
// as the raw Node `Writable` class, not the looser `NodeJS.WritableStream` interface — so
// every function that calls `.from()` itself takes `awslambda.HttpResponseStream`
// specifically (the exact type the runtime hands the wrapped handler below), while
// functions that only ever `.write()`/`.end()` an ALREADY-wrapped stream (writeFrame,
// buildCallbacks, settleTurn) accept the looser `NodeJS.WritableStream` since that's all
// they need structurally.
function sendJson(stream: awslambda.HttpResponseStream, statusCode: number, body: unknown): void {
  const wrapped = awslambda.HttpResponseStream.from(stream, {
    statusCode,
    headers: { "Content-Type": "application/json" },
  });
  wrapped.write(JSON.stringify(body));
  wrapped.end();
}

function openNdjsonStream(stream: awslambda.HttpResponseStream): NodeJS.WritableStream {
  return awslambda.HttpResponseStream.from(stream, {
    statusCode: 200,
    // "application/x-ndjson" — newline-delimited JSON, one frame per line, matching this
    // handler's StreamFrame vocabulary above. Not Server-Sent Events (`text/event-stream`):
    // no "event:"/"data:" framing or reconnect semantics are needed for a single
    // request/response chat turn, just an incrementally-flushed body the client reads with
    // a streaming fetch() reader and splits on "\n".
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}

interface ParsedRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
  body: unknown;
}

function parseEvent(event: APIGatewayProxyEventV2): ParsedRequest {
  const rawBody = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : "";
  let body: unknown = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = {};
    }
  }

  return {
    method: event.requestContext?.http?.method ?? "GET",
    path: event.rawPath ?? "/",
    headers: event.headers ?? {},
    cookies: parseCookies({ cookies: event.cookies, headerCookie: event.headers?.cookie ?? event.headers?.Cookie ?? null }),
    body,
  };
}

// Deliberately under a `/chat/` sub-path distinct from the ordinary Next.js CRUD routes
// at `/api/v1/sol/conversations/**` (transcript GET, rename/archive, etc., served by
// serverFn). CloudFront's cache-behavior routing is path-pattern-only — it can't dispatch
// the same path to a different origin based on HTTP method — so a streaming POST turn and
// a plain GET transcript fetch can't share one path across two different Lambdas. Giving
// SolChatFn's own routes their own path prefix (`api/v1/sol/chat/*`) lets CloudFront send
// exactly that subtree here and leave the rest of `api/v1/sol/*` on the default (serverFn)
// behavior, with no path collision. See compute-stack.ts's matching CloudFront behavior.
const MESSAGES_RE = /^\/api\/v1\/sol\/chat\/conversations\/([^/]+)\/messages\/?$/;
const CONFIRM_RE = /^\/api\/v1\/sol\/chat\/conversations\/([^/]+)\/messages\/([^/]+)\/confirm\/?$/;

/** Fetches a conversation the caller must own — SolConversation's primary key embeds
 * `updatedAt` (see solEntities.ts), so there's no direct `.get({userId, id})`; this
 * queries the user's whole conversation list and finds the match, same "small per-user
 * list, filter in memory" pattern app/api/v1/media/route.ts's DELETE already uses for an
 * analogous problem (UploadedImage's key doesn't include a bare id-lookup index either). */
async function loadOwnedConversation(userId: string, conversationId: string) {
  const { data: conversations } = await SolConversation.query.primary({ userId }).go({ pages: "all" });
  return conversations.find((c) => c.id === conversationId) ?? null;
}

/** Loads both the memory facts to feed into the system prompt AND whether memory is
 * enabled at all — the two are related but distinct: `memoryEnabled: false` and "enabled
 * but the user has zero facts saved yet" both yield an empty `facts` array, so callers
 * that need to gate something else on the *setting itself* (e.g. whether to attempt
 * automatic memory extraction after this turn — see maybeExtractMemoryFact) can't infer it
 * from `facts` alone and need `memoryEnabled` explicitly. */
async function loadMemoryContext(userId: string): Promise<{ memoryEnabled: boolean; facts: string[] }> {
  const { data: prefs } = await SolPreferences.get({ userId }).go();
  const memoryEnabled = prefs?.memoryEnabled !== false;
  if (!memoryEnabled) return { memoryEnabled: false, facts: [] };
  const { data: facts } = await SolMemoryFact.query.primary({ userId }).go({ pages: "all" });
  return { memoryEnabled: true, facts: facts.map((f) => f.text) };
}

/** Finds the most recent user-authored message strictly before `beforeCreatedAt` in an
 * already-fetched transcript and returns its plain text — used to recover "what did the
 * user actually say" for a resumed (post-confirmation) turn, where there's no fresh
 * `text` in the request body the way there is on the initial /messages route. Reuses a
 * transcript the caller already fetched for its own purposes (see handleConfirmRoute)
 * rather than issuing another query. */
function findPrecedingUserText(
  messages: Array<{ role: string; createdAt: string; content: unknown }>,
  beforeCreatedAt: string,
): string {
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

/** Sums the usage of every SolMessage persisted in this conversation at or after
 * `sinceIso` — used to recover "how much was actually consumed" when
 * InsufficientCreditsError aborts a turn mid-loop. solAgent.ts's continueLoop persists each
 * assistant message (with its real `usage`) BEFORE the next iteration's budgetGuard check
 * can throw, but the thrown error itself carries no usage payload (RunAgentTurnResult is
 * never constructed on that path) — so the persisted rows are the only source of truth for
 * what to actually charge for. Same "re-derive from the real rows" discipline as
 * bumpConversationActivity. */
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

/** Fire-and-forget per lib/solAnalytics.ts's own documented convention ("never awaited
 * inline in a request path") — a failed analytics write must never affect the real
 * response (already sent/streamed by the time this fires) or mask a real error. */
function recordUsageEventBestEffort(input: Parameters<typeof recordSolUsageEvent>[0]): void {
  void recordSolUsageEvent(input).catch((err) => console.error("Failed to record SOL usage event:", err));
}

/** Shared tail end of both the fresh-turn and resume-turn handlers: given the Promise
 * returned by runAgentTurn/resumeAgentTurn (already wired to stream frames via its
 * callbacks as they fire), finishes the HTTP response correctly for each of the three
 * possible outcomes — a completed answer (charge once, bump conversation bookkeeping,
 * message_done), a paused confirmation (no charge yet), or a mid-loop credit exhaustion
 * (charge the real partial usage, credit_exhausted). Also records a SolUsageEvent
 * analytics row (lib/solAnalytics.ts — pre-existing, previously-unwired scaffolding for
 * plexo-admin's SOL usage dashboard) for every outcome except a paused confirmation, which
 * isn't a completed turn yet. */
async function settleTurn(
  stream: NodeJS.WritableStream,
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
    /** Whether the user has SOL memory enabled at all (SolPreferences.memoryEnabled) —
     * gates automatic post-turn memory extraction below entirely; when false, the
     * heuristic in lib/ai/memoryExtraction.ts is never even run. */
    memoryEnabled: boolean;
    /** The user's current SolMemoryFact text, for maybeExtractMemoryFact's dedup context —
     * already loaded once per request (loadMemoryContext) to build the system prompt, so
     * this reuses it instead of querying again. */
    existingMemoryFacts: string[];
    /** What the user actually said this turn, for memory extraction — the fresh-message
     * route's own request text, or (for a resumed/post-confirmation turn) the preceding
     * user message recovered from the transcript. Empty string is a safe no-op default:
     * looksMemoryWorthy short-circuits to false on empty input. */
    userTextForMemory: string;
  },
): Promise<void> {
  const startedAtMs = new Date(ctx.turnStartedAt).getTime();
  try {
    const result = await turnPromise;

    if (result.pendingConfirmation) {
      // Already streamed by the onToolCallAwaitingConfirmation callback below — nothing
      // more to send. No chargeUsage, no analytics event: no full turn has completed yet
      // (the model calls made so far to reach this pause are billed/recorded once the
      // turn eventually finishes, whether that's via confirm-and-continue or
      // decline-and-continue).
      stream.end();
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
    writeFrame(stream, { type: "message_done", messageId: lastMessage?.id ?? null, usage: result.usage });
    stream.end();

    // Background bookkeeping only — this is a genuinely finished exchange (we're past the
    // `pendingConfirmation` early-return above), so it's safe to let SOL notice a durable
    // fact/preference and save it for next time. Fire-and-forget: never awaited, never
    // allowed to delay a response the user already received (see settleTurn's own doc
    // comment — the response is already streamed/ended by this point).
    if (ctx.memoryEnabled) {
      void maybeExtractMemoryFact({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        userText: ctx.userTextForMemory,
        assistantText: result.finalText,
        existingFacts: ctx.existingMemoryFacts,
      }).catch((err) => console.error("maybeExtractMemoryFact failed:", err));
    }

    // `id`/`createdAt` pinned to the final assistant SolMessage's own — see
    // RecordSolUsageEventInput's own comment on why (lets a later feedback PATCH find
    // this row with zero extra lookup, keyed only on the SolMessage id it already has).
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
      writeFrame(stream, { type: "credit_exhausted", requiredCredits, availableCredits: balance.total });
      stream.end();

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
    writeFrame(stream, { type: "error", message });
    stream.end();

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

function buildCallbacks(stream: NodeJS.WritableStream) {
  const toolCalls: SolToolCallRecord[] = [];
  const callbacks = {
    onTextDelta: (delta: string) => writeFrame(stream, { type: "token", text: delta }),
    onToolCallStart: (call: { id: string; name: string; args: unknown }) =>
      writeFrame(stream, { type: "tool_call_start", id: call.id, name: call.name, label: humanizeToolName(call.name), args: call.args }),
    onToolCallAwaitingConfirmation: async (call: { id: string; name: string; args: unknown }) => {
      writeFrame(stream, { type: "tool_call_awaiting_confirmation", id: call.id, name: call.name, args: call.args });
    },
    onToolCallResult: (result: { id: string; name: string; status: "success" | "error" | "cancelled"; result?: unknown }) => {
      writeFrame(stream, { type: "tool_call_result", id: result.id, name: result.name, status: result.status, result: result.result });
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

/** Bedrock/Anthropic content blocks for the new user message: plain text plus any
 * attachments. Anthropic's Messages API (which Bedrock's Claude models are wire-compatible
 * with — see lib/ai/providers/bedrockClaude.ts's own comment) supports a `source: {type:
 * "url", url}` form for both image and document content blocks, letting the model fetch
 * the file itself instead of this handler downloading/base64-encoding it first — the
 * simplest correct option given attachments here are already-hosted URLs (from
 * app/api/v1/sol/upload/route.ts's presigned-POST flow), not raw bytes in the request body.
 * Anything that isn't an image/document (e.g. a voice-note attachment, which is
 * transcribed to plain text client-side via /api/v1/sol/voice/transcribe before it's ever
 * sent here) is skipped with a warning rather than guessed at. */
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

async function handleMessagesRoute(
  conversationId: string,
  resolved: LambdaResolvedUser,
  body: unknown,
  stream: awslambda.HttpResponseStream,
): Promise<void> {
  const parsed = body as { text?: string; attachments?: Array<{ type?: string; url?: string }>; modelTier?: string };
  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  const modelTier = parsed.modelTier as ModelTier;

  if (!text || !VALID_TIERS.has(modelTier)) {
    sendJson(stream, 400, { error: "A non-empty `text` and a valid `modelTier` (BASIC|MEDIUM|HIGH) are required." });
    return;
  }

  const conversation = await loadOwnedConversation(resolved.userId, conversationId);
  if (!conversation) {
    sendJson(stream, 404, { error: "Conversation not found." });
    return;
  }

  const requiredCredits = estimateWorstCaseAgentTurnCost(modelTier, text.length);
  const preflightBalance = await ensureCreditPeriod(resolved.userId);
  if (preflightBalance.total < requiredCredits) {
    sendJson(stream, 402, { error: "insufficient_credits", requiredCredits, availableCredits: preflightBalance.total });
    return;
  }

  const { memoryEnabled, facts: memoryFacts } = await loadMemoryContext(resolved.userId);
  const httpStream = openNdjsonStream(stream);
  const turnStartedAt = new Date().toISOString();
  const { callbacks, toolCalls } = buildCallbacks(httpStream);

  const deps: AgentTurnDeps = {
    conversationId,
    resolvedUser: resolved,
    modelTier,
    userMessageContent: buildUserMessageContent(text, parsed.attachments),
    memoryFacts,
    ...callbacks,
    // Re-checked before EVERY loop iteration (up to MAX_TOOL_ITERATIONS times per turn),
    // not just once up front — a long tool-using turn can, in principle, exhaust credits
    // a generous up-front worst-case estimate still passed (that estimate covers the
    // WORST case of every remaining iteration also maxing out its output; a real turn
    // that's already burned through several iterations has less budget-headroom left for
    // the ones still to come than the single up-front check alone would suggest at a
    // glance — this is what actually enforces the per-call ceiling in practice).
    budgetGuard: async () => {
      const balance = await ensureCreditPeriod(resolved.userId);
      const perCallEstimate = estimateWorstCaseCost("bedrock_claude", modelTier, "agent_chat", text.length);
      return balance.total >= perCallEstimate;
    },
  };

  await settleTurn(httpStream, runAgentTurn(deps), {
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
  });
}

async function handleConfirmRoute(
  conversationId: string,
  messageId: string,
  resolved: LambdaResolvedUser,
  body: unknown,
  stream: awslambda.HttpResponseStream,
): Promise<void> {
  const parsed = body as { decision?: string };
  const decision = parsed.decision;
  if (decision !== "confirmed" && decision !== "declined") {
    sendJson(stream, 400, { error: '`decision` must be "confirmed" or "declined".' });
    return;
  }

  const conversation = await loadOwnedConversation(resolved.userId, conversationId);
  if (!conversation) {
    sendJson(stream, 404, { error: "Conversation not found." });
    return;
  }

  // The confirm route's {messageId} path param is the PENDING SolMessage row's own `id`
  // (what runAgentTurn's `pendingConfirmation.messageId` reported to the client that
  // originally streamed it) — not the same as the Anthropic tool_use id resumeAgentTurn
  // actually keys off of (`pendingConfirmation.toolCallId`). Recover the latter from the
  // stored message's own content blocks, same "query the user's/conversation's small list,
  // find by id in memory" pattern as loadOwnedConversation above.
  const { data: messages } = await SolMessage.query.primary({ conversationId }).go({ pages: "all" });
  const pendingMessage = messages.find((m) => m.id === messageId && m.confirmationState === "PENDING");
  if (!pendingMessage) {
    sendJson(stream, 404, { error: "No pending confirmation found for this message." });
    return;
  }
  const toolUseBlock = Array.isArray(pendingMessage.content)
    ? (pendingMessage.content.find((block: { type?: string; id?: string; input?: unknown }) => block?.type === "tool_use") as
        | { type?: string; id?: string; input?: unknown }
        | undefined)
    : undefined;
  const toolCallId = toolUseBlock?.id;
  if (!toolCallId) {
    sendJson(stream, 500, { error: "Pending confirmation message has no tool_use block." });
    return;
  }

  const modelTier = (conversation.modelTier as ModelTier) ?? "BASIC";
  await ensureCreditPeriod(resolved.userId);
  const { memoryEnabled, facts: memoryFacts } = await loadMemoryContext(resolved.userId);
  const userTextForMemory = findPrecedingUserText(messages, pendingMessage.createdAt);
  const httpStream = openNdjsonStream(stream);
  const turnStartedAt = new Date().toISOString();
  const { callbacks, toolCalls } = buildCallbacks(httpStream);
  // Same conservative estimate basis as the fresh-turn route uses for its own budgetGuard —
  // there's no new user-authored text on a resume, so the tool call's own args length is
  // the closest available signal for "how much input will this next model call replay",
  // itself already dwarfed in practice by the full conversation history every call resends.
  const approxInputChars = JSON.stringify(toolUseBlock?.input ?? {}).length;

  const deps: ResumeAgentTurnDeps = {
    conversationId,
    resolvedUser: resolved,
    modelTier,
    toolCallId,
    decision,
    memoryFacts,
    ...callbacks,
    budgetGuard: async () => {
      const balance = await ensureCreditPeriod(resolved.userId);
      const perCallEstimate = estimateWorstCaseCost("bedrock_claude", modelTier, "agent_chat", approxInputChars);
      return balance.total >= perCallEstimate;
    },
  };

  await settleTurn(httpStream, resumeAgentTurn(deps), {
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
  });
}

export const handler = awslambda.streamifyResponse(async (event: APIGatewayProxyEventV2, responseStream: awslambda.HttpResponseStream) => {
  // Closes compute-stack.ts's own TODO(security): reject anything that reaches this
  // Function URL directly (bypassing CloudFront, which is the only party that attaches
  // this header — see that stack's originVerifySecret comment) before any app logic,
  // session decoding, or DynamoDB access runs at all.
  const expectedSecret = process.env.PLEXO_ORIGIN_VERIFY_SECRET;
  const actualSecret = event.headers?.["x-origin-verify"];
  if (!expectedSecret || actualSecret !== expectedSecret) {
    sendJson(responseStream, 403, { error: "Forbidden." });
    return;
  }

  const request = parseEvent(event);

  if (request.method !== "POST") {
    sendJson(responseStream, 404, { error: "Not found." });
    return;
  }

  const messagesMatch = request.path.match(MESSAGES_RE);
  const confirmMatch = request.path.match(CONFIRM_RE);
  if (!messagesMatch && !confirmMatch) {
    sendJson(responseStream, 404, { error: "Not found." });
    return;
  }

  const resolved = await resolveSessionUser(request.cookies);
  if (!resolved) {
    sendJson(responseStream, 401, { error: "Unauthorized" });
    return;
  }

  try {
    if (confirmMatch) {
      const [, conversationId, messageId] = confirmMatch;
      await handleConfirmRoute(conversationId, messageId, resolved, request.body, responseStream);
    } else if (messagesMatch) {
      const [, conversationId] = messagesMatch;
      await handleMessagesRoute(conversationId, resolved, request.body, responseStream);
    }
  } catch (err) {
    // A failure here means one of the pre-stream steps (ownership check, credit
    // pre-flight, memory-facts load) itself threw, BEFORE openNdjsonStream ever committed
    // this response to 200/ndjson — safe to still send a clean JSON error status.
    console.error("SOL chat handler failed before streaming began:", err);
    sendJson(responseStream, 500, { error: "Internal error." });
  }
});
