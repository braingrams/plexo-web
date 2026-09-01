import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { EntityItem } from "electrodb";
import { docClient } from "./client";
import { User } from "./coreEntities";
import { CreditLedgerEntry, StripeEvent } from "./ledgerEntities";

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

export async function chargeFlatCredits(
  userId: string,
  credits: number,
  description: string,
): Promise<{ allowanceBalance: number; topupBalance: number }> {
  return debitCredits(userId, credits, "AI_USAGE", description);
}

// chargeUsage (real token-usage pricing) and ensureCreditPeriod (monthly allowance
// grant) port the same way — read User, compute, conditional TransactWriteCommand
// against User (plexo-core) + CreditLedgerEntry (plexo-ledger). Omitted here to keep
// this file to the two patterns that actually differ (idempotent external-event credit,
// and optimistic-lock debit); wiring lib/ai/generate.ts and the monthly-grant call site
// to these is app-integration work for whenever this table goes live, not new design.

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
