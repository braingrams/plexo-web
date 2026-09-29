import { randomUUID } from "crypto";

import { SolUsageEvent, SolUsageEventContent, SolDailyStat } from "@/lib/db/opsEntities";
import { redact } from "@/lib/privacy/redact";

// WRITE side of SOL usage analytics — plexo-admin's own lib/solAnalytics.ts is the READ
// side over the same three entities (SolUsageEvent/SolUsageEventContent/SolDailyStat in
// lib/db/opsEntities.ts); same filename, opposite ends of the same data, don't confuse
// the two.
//
// Not wired into any call site yet. The two exports below are meant to be called:
//   - recordSolUsageEvent: from the SOL chat-turn handler (lambda/sol-chat/index.ts, still
//     a 501 stub as of this writing — see its own TODO comments), right after
//     lib/db/ledgerOperations.ts's chargeUsage() charges credits for the completed turn —
//     a sibling analytics write alongside that charge, not a replacement for it.
//   - recordSolFeedback: from the (not-yet-existing) SOL feedback API route, once a user
//     thumbs-up/thumbs-downs a turn.
//
// Both are `async` so a caller can `.catch()` them, but neither should ever be awaited
// inline in a request path — call them fire-and-forget, the same convention
// lib/analyticsRollup.ts's recordPageViewRollup uses at its own call site
// (app/pub/[domain]/[[...slug]]/route.ts):
//
//   void recordSolUsageEvent({ ... }).catch((err) => console.error("Failed to record SOL usage:", err));

const PREVIEW_MAX_CHARS = 500;

export interface SolToolCallRecord {
  name: string;
  destructive: boolean;
  confirmed: boolean;
  executed: boolean;
  errorCode?: string;
}

export interface RecordSolUsageEventInput {
  // Caller may pre-generate this (e.g. to correlate with a SolMessage id) — defaults to a
  // fresh uuid otherwise. Also becomes SolUsageEventContent's id.
  id?: string;
  // Caller may pre-supply this too, alongside `id` — set both to the completed turn's own
  // final assistant SolMessage's {id, createdAt} and this row's primary key exactly mirrors
  // that message's, letting a later recordSolFeedback call (keyed only on the SolMessage id
  // + createdAt a feedback route already has on hand) patch the right row with zero extra
  // lookup. Defaults to "now" otherwise.
  createdAt?: string;
  userId: string;
  organizationId: string;
  conversationId: string;
  provider: string;
  tier: "BASIC" | "MEDIUM" | "HIGH";
  inputTokens: number;
  outputTokens: number;
  creditsCharged: number;
  latencyMs: number;
  outcome: "success" | "error" | "timeout";
  errorCode?: string;
  toolCalls?: SolToolCallRecord[];
  attachmentCount?: number;
  attachmentTypes?: string[];
  voiceTranscriptUsed?: boolean;
  // Raw, unredacted prompt/response text — redacted and truncated here before being
  // persisted, never stored as-is.
  prompt?: string;
  response?: string;
}

function preview(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const scrubbed = redact(text);
  return scrubbed.length > PREVIEW_MAX_CHARS ? scrubbed.slice(0, PREVIEW_MAX_CHARS) : scrubbed;
}

/**
 * Atomically increments the fixed set of SolDailyStat dimension rows a single completed
 * turn feeds — same "sparse rows per dimension, `.update().add()` upserts cleanly on a
 * first hit" pattern as lib/analyticsRollup.ts's recordPageViewRollup; see SolDailyStat's
 * own comment in lib/db/opsEntities.ts for why sparse rows over nested map counters.
 */
async function bumpDailyStats(input: {
  date: string;
  provider: string;
  tier: string;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  creditsCharged: number;
  latencyMs: number;
  outcome: "success" | "error" | "timeout";
  errorCode?: string;
  toolCalls: SolToolCallRecord[];
}): Promise<void> {
  const { date } = input;

  const bumpWithTotals = (dimension: string) =>
    SolDailyStat.update({ date, dimension })
      .add({
        count: 1,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        creditsCharged: input.creditsCharged,
        latencyMsSum: input.latencyMs,
      })
      .go();

  const bumpCountOnly = (dimension: string) => SolDailyStat.update({ date, dimension }).add({ count: 1 }).go();

  const writes: Promise<unknown>[] = [
    bumpWithTotals("TOTAL"),
    bumpWithTotals(`MODEL#${input.provider}/${input.tier}`),
    // Sparse DAU row — presence (not the count itself) is what a "daily active users"
    // chart cares about, but tracking the count too costs nothing extra.
    bumpCountOnly(`USER#${input.userId}`),
  ];

  if (input.outcome !== "success") {
    writes.push(bumpCountOnly(`ERROR#${input.errorCode || input.outcome}`));
  }

  for (const call of input.toolCalls) {
    writes.push(bumpCountOnly(`TOOL#${call.name}`));
    // A destructive tool call the user declined to confirm — tracked separately so the
    // dashboard can show a confirm-vs-decline rate per tool.
    if (call.destructive && !call.confirmed) {
      writes.push(bumpCountOnly(`TOOL#${call.name}#DECLINED`));
    }
  }

  await Promise.all(writes);
}

/**
 * Records one completed SOL chat turn: a permanent SolUsageEvent row, a short-TTL
 * SolUsageEventContent row holding a redacted/truncated prompt+response preview, and the
 * day's SolDailyStat rollup increments (TOTAL, MODEL#, one TOOL# per tool call plus a
 * #DECLINED variant for declined destructive calls, a sparse USER# DAU row, and an ERROR#
 * row on non-success outcomes). See the file header for the real call site (not wired in
 * here).
 */
export async function recordSolUsageEvent(input: RecordSolUsageEventInput): Promise<void> {
  const id = input.id ?? randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const date = createdAt.slice(0, 10);
  const toolCalls = input.toolCalls ?? [];

  await Promise.all([
    SolUsageEvent.create({
      id,
      userId: input.userId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      provider: input.provider,
      tier: input.tier,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      creditsCharged: input.creditsCharged,
      latencyMs: input.latencyMs,
      outcome: input.outcome,
      errorCode: input.errorCode,
      toolCalls,
      attachmentCount: input.attachmentCount ?? 0,
      attachmentTypes: input.attachmentTypes ?? [],
      voiceTranscriptUsed: input.voiceTranscriptUsed ?? false,
      createdAt,
    }).go(),
    SolUsageEventContent.create({
      id,
      conversationId: input.conversationId,
      createdAt,
      promptPreview: preview(input.prompt),
      responsePreview: preview(input.response),
    }).go(),
    bumpDailyStats({
      date,
      provider: input.provider,
      tier: input.tier,
      userId: input.userId,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      creditsCharged: input.creditsCharged,
      latencyMs: input.latencyMs,
      outcome: input.outcome,
      errorCode: input.errorCode,
      toolCalls,
    }),
  ]);
}

/**
 * Patches the `feedback` field on an already-written SolUsageEvent — looked up by its
 * known primary key (conversationId/createdAt/id, the same composite it was created with,
 * see SolUsageEvent's primary index in lib/db/opsEntities.ts) — and bumps today's
 * FEEDBACK#UP/FEEDBACK#DOWN SolDailyStat dimension. See the file header for the real call
 * site (not wired in here).
 */
export async function recordSolFeedback(
  usageEventId: string,
  conversationId: string,
  createdAt: string,
  rating: "UP" | "DOWN",
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);

  await Promise.all([
    SolUsageEvent.patch({ conversationId, createdAt, id: usageEventId }).set({ feedback: rating }).go(),
    SolDailyStat.update({ date, dimension: `FEEDBACK#${rating}` }).add({ count: 1 }).go(),
  ]);
}
