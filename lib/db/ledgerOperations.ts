import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { EntityItem } from "electrodb";
import { docClient } from "./client";
import { User } from "./coreEntities";
import { CreditLedgerEntry, StripeEvent } from "./ledgerEntities";
import { PLAN_MONTHLY_CREDITS, type SubscriptionPlan } from "@/lib/subscription";
import { computeCostUsd, creditsForUsd } from "@/lib/credits/pricing";
import { MAX_TOKENS } from "@/lib/ai/generate";
import type { AiActionMode, AiProvider, ConcreteTier, GenerateOutcome } from "@/lib/ai/types";

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
const MAX_OPTIMISTIC_RETRIES = 5;

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
 * Shared debit path for chargeUsage and chargeFlatCredits — allowance bucket first, then
 * top-up, same order as the Postgres version. Left unclamped on overdraft for the same
 * reason as the original: a deficit here means the pre-flight estimate undershot real
 * usage, and should be visible rather than silently floored at zero.
 */
async function debitCredits(
  userId: string,
  credits: number,
  type: "AI_USAGE",
  description: string,
  metadata?: Record<string, unknown>,
): Promise<{ allowanceBalance: number; topupBalance: number }> {
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
    const ledgerEntryId = crypto.randomUUID();

    // ElectroDB's `.where()` callback builds one condition-expression STRING — combine
    // multiple checks via template-literal concatenation, not a fluent `.and()`.
    const updateUser = User.patch({ id: userId })
      .set({ allowanceBalance: nextAllowance, topupBalance: nextTopup })
      .where(
        (attr, op) =>
          `${op.eq(attr.allowanceBalance, allowanceBalance)} AND ${op.eq(attr.topupBalance, topupBalance)}`,
      )
      .params();

    const createEntry = CreditLedgerEntry.create({
      id: ledgerEntryId,
      userId,
      type,
      amount: -credits,
      balanceAfter: nextAllowance + nextTopup,
      description,
      metadata,
    }).params();

    try {
      await docClient.send(buildTransactWrite(updateUser, createEntry));
      return { allowanceBalance: nextAllowance, topupBalance: nextTopup };
    } catch (err) {
      if (isConditionalCheckFailure(err) && attempt < MAX_OPTIMISTIC_RETRIES - 1) continue;
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
): number {
  const conservativeInputTokens = Math.ceil(approxInputChars / 3);
  const maxOutputTokens = MAX_TOKENS[mode];
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
): Promise<{ allowanceBalance: number; topupBalance: number }> {
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
  params: { provider: AiProvider; tier: ConcreteTier; mode: AiActionMode; usage: GenerateOutcome["usage"] },
): Promise<{ creditsCharged: number; allowanceBalance: number; topupBalance: number }> {
  const usd = computeCostUsd(params.provider, params.tier, params.usage);
  const credits = creditsForUsd(usd);
  const description = `${params.mode} (${params.provider}/${params.tier})`;
  const metadata = {
    provider: params.provider,
    tier: params.tier,
    mode: params.mode,
    inputTokens: params.usage?.inputTokens ?? null,
    outputTokens: params.usage?.outputTokens ?? null,
    costUsd: usd,
  };
  const { allowanceBalance, topupBalance } = await debitCredits(userId, credits, "AI_USAGE", description, metadata);
  return { creditsCharged: credits, allowanceBalance, topupBalance };
}

export interface CreditBalance {
  allowanceBalance: number;
  topupBalance: number;
  total: number;
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
  const user = data as UserItem;
  const allowanceBalance = user.allowanceBalance ?? 0;
  const topupBalance = user.topupBalance ?? 0;
  const allowanceResetAt = user.allowanceResetAt ?? new Date(0).toISOString();
  const subscriptionPlan = user.subscriptionPlan ?? "FREE";

  const now = new Date();
  if (now <= new Date(allowanceResetAt)) {
    return { allowanceBalance, topupBalance, total: allowanceBalance + topupBalance, allowanceResetAt };
  }

  const grant = PLAN_MONTHLY_CREDITS[subscriptionPlan];
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
    description: `Monthly ${subscriptionPlan} allowance`,
  }).params();

  try {
    await docClient.send(buildTransactWrite(updateUser, createEntry));
    return { allowanceBalance: grant, topupBalance, total: grant + topupBalance, allowanceResetAt: nextResetAt };
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err;
    // Lost the race to another concurrent request — read back what it wrote.
    const { data: fresh } = await User.get({ id: userId }).go();
    if (!fresh) throw new Error(`ensureCreditPeriod: user ${userId} vanished mid-race`);
    const freshUser = fresh as UserItem;
    const freshAllowance = freshUser.allowanceBalance ?? 0;
    const freshTopup = freshUser.topupBalance ?? 0;
    const freshResetAt = freshUser.allowanceResetAt ?? nextResetAt;
    return { allowanceBalance: freshAllowance, topupBalance: freshTopup, total: freshAllowance + freshTopup, allowanceResetAt: freshResetAt };
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

  const grant = PLAN_MONTHLY_CREDITS[newPlan];
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
    description: `Plan changed to ${newPlan} — allowance refreshed`,
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
