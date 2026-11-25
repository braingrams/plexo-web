import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { EntityItem } from "electrodb";
import { docClient } from "./client";
import { User } from "./coreEntities";
import { CreditLedgerEntry, StripeEvent } from "./ledgerEntities";
import type { SubscriptionPlan } from "@/lib/subscription";
import { firstSiteGrantCredits, planMonthlyCredits } from "@/lib/credits/value";
import { allowancePlan } from "@/lib/plan/entitlement";
import { planLabel } from "@/lib/plan/plans";
import { computeCostUsd, creditsForUsd } from "@/lib/credits/pricing";
import { MAX_TOKENS } from "@/lib/ai/generate";
import { type AiActionMode, type AiProvider, type ConcreteTier, type GenerateOutcome, AI_ACTION_LABELS } from "@/lib/ai/types";

type UserItem = EntityItem<typeof User>;

// Ported from lib/credits/ledger.ts. The Postgres version wraps "update User.balance" +
// "insert CreditLedgerEntry" in one $transaction and lets Postgres compute+return the new
// balance atomically. DynamoDB's TransactWriteItems has no equivalent of RETURNING —
// items in a transaction can't read back their own post-write values — so balanceAfter
// has to be computed in application code from a value read just before the transaction,
// with an optimistic-concurrency condition (topupBalance/allowanceBalance must still
// match what was read) guarding against a concurrent writer racing us. A conflict means
// retry, not corruption: the transaction simply fails and we recompute against the
// now-current balance.
// Raised from 5 when credit holds arrived: several chats (or a chat plus an image) can now touch one
// account in the same instant, and each lost race costs a retry. The short random pause stops the
// losers from colliding again in lockstep.
const MAX_OPTIMISTIC_RETRIES = 15;
const retryPause = (attempt: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.random() * Math.min(200, 15 * (attempt + 1))));

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string }; CancellationReasons?: Array<{ Code?: string }> };
  return (
    anyErr?.name === "ConditionalCheckFailedException" ||
    anyErr?.cause?.name === "ConditionalCheckFailedException" ||
    anyErr?.name === "TransactionCanceledException" ||
    Boolean(anyErr?.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed"))
  );
}

/**
 * DynamoDB refuses a write to an item while another request's transaction on it is in flight
 * ("Transaction is ongoing for the item") — e.g. a chat placing a credit hold at the very moment
 * another chat's bill is being written. Nothing is wrong and nothing was written: the caller just
 * tries again. Kept apart from isConditionalCheckFailure on purpose — that one means "someone
 * else's write won", and the idempotent claims below must not mistake a mere collision for it.
 */
function isTransactionConflict(err: unknown): boolean {
  const anyErr = err as { name?: string; message?: string; cause?: { name?: string }; CancellationReasons?: Array<{ Code?: string }> };
  return (
    anyErr?.name === "TransactionConflictException" ||
    anyErr?.cause?.name === "TransactionConflictException" ||
    Boolean(anyErr?.CancellationReasons?.some((r) => r.Code === "TransactionConflict")) ||
    String(anyErr?.message ?? "").includes("Transaction is ongoing for the item")
  );
}

/** A lost race or a collision — either way the credit write is simply attempted again from a fresh read. */
const isRetryableContention = (err: unknown) => isConditionalCheckFailure(err) || isTransactionConflict(err);

/**
 * Credits a completed Stripe top-up purchase. Idempotent the same way as the Postgres
 * version: the StripeEvent claim is a standalone write performed BEFORE the balance
 * transaction, not inside it — ElectroDB's `.create()` refuses to overwrite an existing
 * item (attribute_not_exists on the key), so a replayed webhook hits that condition
 * failure and returns early without touching any balance.
 */
export async function grantTopup(userId: string, credits: number, stripeEventId: string, description: string): Promise<void> {
  try {
    await StripeEvent.create({ id: stripeEventId }).go();
  } catch (err) {
    if (isConditionalCheckFailure(err)) return; // already processed this Stripe event
    throw err;
  }

  for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
    const { data } = await User.get({ id: userId }).go();
    if (!data || !("id" in data)) throw new Error(`grantTopup: user ${userId} not found`);
    const user = data as UserItem;
    // Both have a `default: 0` in the entity definition, so they're always populated at
    // write time — ElectroDB's generated type still marks them optional structurally,
    // hence the fallback rather than a non-null assertion.
    const topupBalance = user.topupBalance ?? 0;
    const allowanceBalance = user.allowanceBalance ?? 0;

    const nextTopup = topupBalance + credits;
    const balanceAfter = allowanceBalance + nextTopup;
    const ledgerEntryId = crypto.randomUUID();

    const updateUser = User.patch({ id: userId })
      .set({ topupBalance: nextTopup })
      .where((attr, op) => op.eq(attr.topupBalance, topupBalance)) // optimistic lock
      .params();

    const createEntry = CreditLedgerEntry.create({
      id: ledgerEntryId,
      userId,
      type: "TOPUP_PURCHASE",
      amount: credits,
      balanceAfter,
      description,
      stripeEventId,
    }).params();

    try {
      await docClient.send(buildTransactWrite(updateUser, createEntry));
      return;
    } catch (err) {
      if (isConditionalCheckFailure(err) && attempt < MAX_OPTIMISTIC_RETRIES - 1) continue; // lost the race, retry
      throw err;
    }
  }

  throw new Error(`grantTopup: exhausted retries for user ${userId} — too much concurrent balance contention`);
}

/**
 * Credit holds — what stops two chats running at once from spending the same credits.
 *
 * A turn is billed once, when it ends, so while it runs the saved balance doesn't move; a
 * second chat reading that balance would think the credits were all still free. Like a card
 * authorisation, a running turn instead HOLDS the most it could still bill (what it has used
 * so far plus its next step's worst case), and every other check — another chat, an image, a
 * blog post — sees the balance minus everyone's holds. The hold is released when the turn is
 * billed. A hold that is never released (the server died mid-turn) expires on its own after
 * HOLD_TTL_MS, and the turn refreshes it every step, so nothing can stay locked up.
 */
type CreditHold = { credits: number; expiresAt: string };
export const HOLD_TTL_MS = 10 * 60_000;

function liveHolds(raw: unknown, nowMs = Date.now()): Record<string, CreditHold> {
  const out: Record<string, CreditHold> = {};
  if (raw && typeof raw === "object") {
    for (const [id, hold] of Object.entries(raw as Record<string, CreditHold>)) {
      if (hold && typeof hold.credits === "number" && typeof hold.expiresAt === "string" && new Date(hold.expiresAt).getTime() > nowMs) out[id] = hold;
    }
  }
  return out;
}

function sumHolds(holds: Record<string, CreditHold>, exceptId?: string): number {
  return Object.entries(holds).reduce((sum, [id, hold]) => (id === exceptId ? sum : sum + hold.credits), 0);
}

/** The condition every credit write carries: balances AND holds are exactly what was read, so a
 *  concurrent charge or hold makes this write retry against the fresh values instead of losing an update.
 *  heldCredits may not exist yet on an older account — "absent" counts as what was read. */
function unchangedSinceRead(attr: any, op: any, read: { allowanceBalance: number; topupBalance: number; heldCredits: number | undefined }): string {
  const held = read.heldCredits === undefined ? op.notExists(attr.heldCredits) : op.eq(attr.heldCredits, read.heldCredits);
  return `${op.eq(attr.allowanceBalance, read.allowanceBalance)} AND ${op.eq(attr.topupBalance, read.topupBalance)} AND ${held}`;
}

/**
 * Holds up to `ceilingCredits` for one running turn (replacing that turn's earlier hold), only if
 * the account can cover it after every OTHER running turn's hold. Returns false — and changes
 * nothing — when it can't, which is the signal for the turn to stop before the next step.
 */
export async function holdCredits(userId: string, holdId: string, ceilingCredits: number): Promise<{ held: boolean; available: number }> {
  for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
    const { data } = await User.get({ id: userId }).go();
    if (!data || !("id" in data)) throw new Error(`holdCredits: user ${userId} not found`);
    const user = data as UserItem;
    const allowanceBalance = user.allowanceBalance ?? 0;
    const topupBalance = user.topupBalance ?? 0;
    const holds = liveHolds(user.creditHolds);
    const available = allowanceBalance + topupBalance - sumHolds(holds, holdId);
    if (available < ceilingCredits) return { held: false, available };

    const next: Record<string, CreditHold> = { ...holds, [holdId]: { credits: ceilingCredits, expiresAt: new Date(Date.now() + HOLD_TTL_MS).toISOString() } };
    try {
      await User.patch({ id: userId })
        .set({ creditHolds: next, heldCredits: sumHolds(next) })
        .where((attr, op) => unchangedSinceRead(attr, op, { allowanceBalance, topupBalance, heldCredits: user.heldCredits }))
        .go();
      return { held: true, available };
    } catch (err) {
      if (isRetryableContention(err) && attempt < MAX_OPTIMISTIC_RETRIES - 1) { await retryPause(attempt); continue; }
      throw err;
    }
  }
  throw new Error(`holdCredits: exhausted retries for user ${userId} — too much concurrent balance contention`);
}

/** Releases a turn's hold once it has been billed (or abandoned). Safe to call twice. */
export async function releaseHold(userId: string, holdId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
    const { data } = await User.get({ id: userId }).go();
    if (!data || !("id" in data)) return;
    const user = data as UserItem;
    const holds = liveHolds(user.creditHolds);
    const hadIt = Object.prototype.hasOwnProperty.call(holds, holdId);
    // Also tidies expired holds still stored on the account.
    const storedCount = user.creditHolds && typeof user.creditHolds === "object" ? Object.keys(user.creditHolds as object).length : 0;
    if (!hadIt && storedCount === Object.keys(holds).length) return;
    const { [holdId]: _released, ...rest } = holds;
    try {
      await User.patch({ id: userId })
        .set({ creditHolds: rest, heldCredits: sumHolds(rest) })
        .where((attr, op) => unchangedSinceRead(attr, op, { allowanceBalance: user.allowanceBalance ?? 0, topupBalance: user.topupBalance ?? 0, heldCredits: user.heldCredits }))
        .go();
      return;
    } catch (err) {
      if (isRetryableContention(err) && attempt < MAX_OPTIMISTIC_RETRIES - 1) { await retryPause(attempt); continue; }
      throw err;
    }
  }
}

/**
 * Shared debit path for chargeUsage and chargeFlatCredits — allowance bucket first, then
 * top-up. Deliberately NOT clamped: if the real cost overshoots what the account had (a step
 * that was already running when the credits ran out), the balance goes negative and the ledger
 * entry says by how much (`overdrawnBy`), so the overdraft is real, visible and explainable to
 * the customer rather than hidden. Plexo's guard (holdCredits, per step) is what stops a turn
 * early; this only ever records a step that had already been paid for at the provider.
 * `releaseHoldId` drops the turn's credit hold in the same write that bills it.
 */
async function debitCredits(
  userId: string,
  credits: number,
  type: "AI_USAGE",
  description: string,
  metadata?: Record<string, unknown>,
  releaseHoldId?: string,
): Promise<{ allowanceBalance: number; topupBalance: number; overdrawnBy: number }> {
  for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
    const { data } = await User.get({ id: userId }).go();
    if (!data || !("id" in data)) throw new Error(`debitCredits: user ${userId} not found`);
    const user = data as UserItem;
    const topupBalance = user.topupBalance ?? 0;
    const allowanceBalance = user.allowanceBalance ?? 0;

    const fromAllowance = Math.min(allowanceBalance, credits);
    const fromTopup = credits - fromAllowance;
    const nextAllowance = allowanceBalance - fromAllowance;
    const nextTopup = topupBalance - fromTopup;
    // How far past what the account actually had this charge went (0 for a normal charge).
    const overdrawnBy = Math.max(0, credits - Math.max(0, allowanceBalance + topupBalance));
    const ledgerEntryId = crypto.randomUUID();

    const holds = liveHolds(user.creditHolds);
    if (releaseHoldId) delete holds[releaseHoldId];
    const storedHolds = user.creditHolds && typeof user.creditHolds === "object" ? Object.keys(user.creditHolds as object).length : 0;
    const touchHolds = Boolean(releaseHoldId) || storedHolds !== Object.keys(holds).length;

    // ElectroDB's `.where()` callback builds one condition-expression STRING — combine
    // multiple checks via template-literal concatenation, not a fluent `.and()`.
    const updateUser = User.patch({ id: userId })
      .set({ allowanceBalance: nextAllowance, topupBalance: nextTopup, ...(touchHolds ? { creditHolds: holds, heldCredits: sumHolds(holds) } : {}) })
      .where((attr, op) => unchangedSinceRead(attr, op, { allowanceBalance, topupBalance, heldCredits: user.heldCredits }))
      .params();

    const createEntry = CreditLedgerEntry.create({
      id: ledgerEntryId,
      userId,
      type,
      amount: -credits,
      balanceAfter: nextAllowance + nextTopup,
      description,
      metadata: overdrawnBy > 0 ? { ...metadata, overdrawnBy } : metadata,
    }).params();

    try {
      await docClient.send(buildTransactWrite(updateUser, createEntry));
      if (overdrawnBy > 0) console.warn(`[credits] user ${userId}: ${description} cost ${credits} credits, ${overdrawnBy} more than the account had — balance is now ${nextAllowance + nextTopup}`);
      return { allowanceBalance: nextAllowance, topupBalance: nextTopup, overdrawnBy };
    } catch (err) {
      if (isRetryableContention(err) && attempt < MAX_OPTIMISTIC_RETRIES - 1) { await retryPause(attempt); continue; }
      throw err;
    }
  }

  throw new Error(`debitCredits: exhausted retries for user ${userId} — too much concurrent balance contention`);
}

/**
 * Ported from lib/credits/ledger.ts. Pure/no-I/O — computes an upper-bound credit cost for
 * a request before calling the provider, using MAX_TOKENS[mode] as the output ceiling and a
 * conservative ~3-chars/token estimate for input. Used purely as a pre-flight balance gate;
 * `chargeUsage` bills the real, usually-lower amount after.
 */
export function estimateWorstCaseCost(
  provider: AiProvider,
  tier: ConcreteTier,
  mode: AiActionMode,
  approxInputChars: number,
  /** A specific call's output budget (e.g. the bigger retry after a cut-off answer); defaults to the mode's. */
  maxOutputTokensOverride?: number,
): number {
  const conservativeInputTokens = Math.ceil(approxInputChars / 3);
  const maxOutputTokens = maxOutputTokensOverride ?? MAX_TOKENS[mode];
  const usd = computeCostUsd(provider, tier, {
    inputTokens: conservativeInputTokens,
    outputTokens: maxOutputTokens,
  });
  return creditsForUsd(usd);
}

export async function chargeFlatCredits(
  userId: string,
  credits: number,
  description: string,
): Promise<{ allowanceBalance: number; topupBalance: number; overdrawnBy: number }> {
  return debitCredits(userId, credits, "AI_USAGE", description);
}

/**
 * Ported from lib/credits/ledger.ts's chargeUsage, now that app/api/v1/ai/generate/route.ts
 * (its only real call site) is itself being cut over. Deducts the real, usage-based cost of
 * a completed system-AI request — same allowance-then-topup transaction as debitCredits,
 * just with the token-usage pricing math folded in first.
 */
export async function chargeUsage(
  userId: string,
  params: { provider: AiProvider; tier: ConcreteTier; mode: AiActionMode; usage: GenerateOutcome["usage"]; /** The turn's credit hold, dropped in the same write that bills it. */ releaseHoldId?: string },
): Promise<{ creditsCharged: number; allowanceBalance: number; topupBalance: number; overdrawnBy: number }> {
  const usd = computeCostUsd(params.provider, params.tier, params.usage);
  const credits = creditsForUsd(usd);
  const description = AI_ACTION_LABELS[params.mode] || `${params.mode} (${params.provider}/${params.tier})`;
  const metadata = {
    provider: params.provider,
    tier: params.tier,
    mode: params.mode,
    inputTokens: params.usage?.inputTokens ?? null,
    outputTokens: params.usage?.outputTokens ?? null,
    costUsd: usd,
  };
  const { allowanceBalance, topupBalance, overdrawnBy } = await debitCredits(userId, credits, "AI_USAGE", description, metadata, params.releaseHoldId);
  return { creditsCharged: credits, allowanceBalance, topupBalance, overdrawnBy };
}

/**
 * The one-time first-site gift (lib/credits/value.ts): a Free account gets enough AI to build and
 * polish its first website without ever meeting a top-up screen. Goes into the top-up bucket, so
 * it doesn't expire with the month. Exactly-once: the write only succeeds while `firstSiteGrantAt`
 * is unset, so two requests racing to grant it (or a retry) can never give it twice — the loser's
 * condition fails and it just carries on with what the winner wrote.
 */
async function grantFirstSiteCredits(user: UserItem): Promise<void> {
  const credits = firstSiteGrantCredits();
  if (credits <= 0) return;
  const topupBalance = user.topupBalance ?? 0;
  const allowanceBalance = user.allowanceBalance ?? 0;
  const updateUser = User.patch({ id: user.id })
    .set({ topupBalance: topupBalance + credits, firstSiteGrantAt: new Date().toISOString() })
    .where((attr, op) => `${op.notExists(attr.firstSiteGrantAt)} AND ${op.eq(attr.topupBalance, topupBalance)}`)
    .params();
  const createEntry = CreditLedgerEntry.create({
    id: crypto.randomUUID(),
    userId: user.id,
    type: "FIRST_SITE_GRANT",
    amount: credits,
    balanceAfter: allowanceBalance + topupBalance + credits,
    description: "A gift to build your first site",
  }).params();
  try {
    await docClient.send(buildTransactWrite(updateUser, createEntry));
  } catch (err) {
    // Lost a race (someone else granted, or the balance moved): the caller re-reads. If the
    // balance merely moved, the next balance check tries again; the flag still guards "once".
    if (!isRetryableContention(err)) throw err;
  }
}

export interface CreditBalance {
  allowanceBalance: number;
  topupBalance: number;
  total: number;
  /** total minus credits held by turns running right now — what a NEW request may actually spend. */
  available: number;
  allowanceResetAt: string;
}

const ALLOWANCE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Ported from lib/credits/ledger.ts. Unlike grantTopup/debitCredits above, losing the
 * race here isn't an error to retry past — Postgres's `updateMany` version treats
 * `count === 0` as "someone else already granted this period" and just reads back what
 * they wrote, so this does the same: one conditional TransactWriteCommand attempt, and a
 * plain re-read (not a throw) if the condition fails.
 */
export async function ensureCreditPeriod(userId: string): Promise<CreditBalance> {
  const { data } = await User.get({ id: userId }).go();
  if (!data) throw new Error(`ensureCreditPeriod: user ${userId} not found`);
  let user = data as UserItem;
  // Every AI path reads the balance here, so this is where the one-time first-site gift lands:
  // before anyone is ever told they're out of credits while building their first site.
  if (!user.firstSiteGrantAt && allowancePlan(user) === "FREE") {
    await grantFirstSiteCredits(user);
    const { data: fresh } = await User.get({ id: userId }).go();
    if (fresh) user = fresh as UserItem;
  }
  const allowanceBalance = user.allowanceBalance ?? 0;
  const topupBalance = user.topupBalance ?? 0;
  const allowanceResetAt = user.allowanceResetAt ?? new Date(0).toISOString();
  // The plan the account is ENTITLED to right now (a lapsed subscription or ended trial is
  // Free even before the downgrade is written; a trial adds no AI credits) — not the raw column.
  const subscriptionPlan = allowancePlan(user);

  const now = new Date();
  if (now <= new Date(allowanceResetAt)) {
    return { allowanceBalance, topupBalance, total: allowanceBalance + topupBalance, available: allowanceBalance + topupBalance - sumHolds(liveHolds(user.creditHolds)), allowanceResetAt };
  }

  const grant = planMonthlyCredits(subscriptionPlan);
  const nextResetAt = new Date(now.getTime() + ALLOWANCE_PERIOD_MS).toISOString();

  const updateUser = User.patch({ id: userId })
    .set({ allowanceBalance: grant, allowanceResetAt: nextResetAt })
    .where((attr, op) => op.eq(attr.allowanceResetAt, allowanceResetAt)) // optimistic lock
    .params();

  const createEntry = CreditLedgerEntry.create({
    id: crypto.randomUUID(),
    userId,
    type: "MONTHLY_GRANT",
    amount: grant,
    balanceAfter: grant + topupBalance,
    description: `Monthly ${planLabel(subscriptionPlan)} allowance`,
  }).params();

  try {
    await docClient.send(buildTransactWrite(updateUser, createEntry));
    return { allowanceBalance: grant, topupBalance, total: grant + topupBalance, available: grant + topupBalance - sumHolds(liveHolds(user.creditHolds)), allowanceResetAt: nextResetAt };
  } catch (err) {
    if (!isRetryableContention(err)) throw err;
    // Lost the race to another concurrent request — read back what it wrote.
    const { data: fresh } = await User.get({ id: userId }).go();
    if (!fresh) throw new Error(`ensureCreditPeriod: user ${userId} vanished mid-race`);
    const freshUser = fresh as UserItem;
    const freshAllowance = freshUser.allowanceBalance ?? 0;
    const freshTopup = freshUser.topupBalance ?? 0;
    const freshResetAt = freshUser.allowanceResetAt ?? nextResetAt;
    return { allowanceBalance: freshAllowance, topupBalance: freshTopup, total: freshAllowance + freshTopup, available: freshAllowance + freshTopup - sumHolds(liveHolds(freshUser.creditHolds)), allowanceResetAt: freshResetAt };
  }
}

/**
 * Forces an immediate allowance refresh to the new plan's monthly amount, bypassing
 * ensureCreditPeriod's own lazy gate (it only grants once the CURRENT period naturally
 * expires, up to ALLOWANCE_PERIOD_MS away). Called from the Stripe subscription webhook
 * right when a plan change is confirmed — without this, upgrading (or downgrading)
 * mid-period left the OLD plan's allowance untouched until its existing reset date
 * eventually rolled around, which read as "I just paid for Pro and still have Free
 * credits." Same replace-not-add semantics as ensureCreditPeriod's own rollover (this is
 * the existing model applied immediately, not a new policy), and the same
 * optimistic-lock-then-reread-on-race shape as the rest of this file.
 */
export async function grantPlanChangeAllowance(userId: string, newPlan: SubscriptionPlan): Promise<void> {
  const { data } = await User.get({ id: userId }).go();
  if (!data) return;
  const user = data as UserItem;
  const topupBalance = user.topupBalance ?? 0;
  const previousAllowanceResetAt = user.allowanceResetAt ?? new Date(0).toISOString();

  const grant = planMonthlyCredits(newPlan);
  const nextResetAt = new Date(Date.now() + ALLOWANCE_PERIOD_MS).toISOString();

  const updateUser = User.patch({ id: userId })
    .set({ allowanceBalance: grant, allowanceResetAt: nextResetAt })
    .where((attr, op) => op.eq(attr.allowanceResetAt, previousAllowanceResetAt))
    .params();

  const createEntry = CreditLedgerEntry.create({
    id: crypto.randomUUID(),
    userId,
    type: "MONTHLY_GRANT",
    amount: grant,
    balanceAfter: grant + topupBalance,
    description: `Plan changed to ${planLabel(newPlan)} — allowance refreshed`,
  }).params();

  try {
    await docClient.send(buildTransactWrite(updateUser, createEntry));
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err;
    // Someone else (most likely ensureCreditPeriod itself, from a concurrent AI request)
    // already moved allowanceResetAt between our read and write — the balance is already
    // in a valid, current state, just not necessarily this exact grant if that race was
    // itself a natural period rollover. Not worth a retry loop for a webhook-driven,
    // one-off credit; the next real usage still goes through ensureCreditPeriod normally.
  }
}

// ElectroDB's .params() returns the exact runtime shape TransactWriteItems' Update/Put
// members need (TableName, Key/Item, UpdateExpression, ExpressionAttributeNames/Values,
// ConditionExpression) — this is a real pass-through, not a transformation. The cast is
// only needed because @aws-sdk/lib-dynamodb's TransactWriteCommandInput types those
// members more strictly (literal required fields) than ElectroDB's generic `.params()`
// return type, a known friction point between the two libraries, not a logic gap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTransactWrite(updateParams: any, putParams: any): TransactWriteCommand {
  return new TransactWriteCommand({
    TransactItems: [
      { Update: updateParams as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Update"] },
      { Put: putParams as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Put"] },
    ],
  });
}
