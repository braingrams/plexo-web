import type { DynamoDBStreamEvent, DynamoDBStreamHandler } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { StripeEvent } from "./ledgerEntities";

// Consumes plexo-ledger's DynamoDB Stream (enabled in cdk/lib/data-stack.ts). The
// concrete need this solves: an admin marking a WithdrawalRequest PROCESSED (a single,
// synchronous DynamoDB write) must not be the same request/transaction that calls out to
// Paystack's transfer API — that's a slow, third-party, individually-retryable side
// effect, not something to do inside the request that updates the DB. This handler picks
// up the status change from the stream and performs the transfer asynchronously, with an
// idempotency record so a re-delivered stream event (DynamoDB Streams is at-least-once)
// can't trigger the same bank transfer twice.
//
// TODO(Phase 3, once real withdrawal processing lands): wire the actual Paystack
// transfer call where marked below. Not fabricated here — that integration doesn't exist
// yet and shouldn't be guessed at.
//
// Not yet deployed as a real Lambda — cdk/lib/compute-stack.ts is still a Phase 6
// placeholder. Once it isn't, this handler gets registered as an event source mapping on
// the plexo-ledger table's stream, filtered to WithdrawalRequest records only.

export const handler: DynamoDBStreamHandler = async (event: DynamoDBStreamEvent) => {
  for (const record of event.Records) {
    if (record.eventName !== "MODIFY" && record.eventName !== "INSERT") continue;
    if (!record.dynamodb?.NewImage) continue;

    const newImage = unmarshall(record.dynamodb.NewImage as Record<string, never>);
    const oldImage = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage as Record<string, never>) : null;

    const isWithdrawalRequest = typeof newImage.sk === "string" && newImage.sk.startsWith("WITHDRAWAL#");
    if (!isWithdrawalRequest) continue;

    const justProcessed = newImage.status === "PROCESSED" && oldImage?.status !== "PROCESSED";
    if (!justProcessed) continue;

    const idempotencyKey = `withdrawal-transfer#${newImage.id}`;
    try {
      // Reuses StripeEvent as a generic "claim this id once" record — same pattern, not
      // actually Stripe-specific despite the entity name (see ledgerEntities.ts).
      await StripeEvent.create({ id: idempotencyKey }).go();
    } catch {
      continue; // already handled this withdrawal's transfer — stream redelivery, not a new event
    }

    // TODO(Phase 3): call Paystack's transfer API with newImage.amountCents,
    // newImage.encryptedAccountNumber (decrypt first), newImage.bankName. On failure,
    // this should surface to plexo-admin's withdrawals dashboard for manual retry rather
    // than silently swallowing the error — not designed yet, intentionally left open.
    console.log(`TODO(Phase 3): execute transfer for withdrawal ${newImage.id}`);
  }
};
