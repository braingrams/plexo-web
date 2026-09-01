import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-ledger: CreditLedgerEntry, SellerLedgerEntry, WithdrawalRequest, StripeEvent,
// PaystackWebhookEvent — field shapes ported 1:1 from prisma/schema.prisma. This table
// alone gets point-in-time recovery and a customer-managed KMS key (cdk/lib/data-stack.ts)
// since it's the only one holding financial data.

const table = TABLES.ledger;

export const CreditLedgerEntry = new Entity(
  {
    model: { entity: "creditLedgerEntry", version: "1", service: "plexoLedger" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      type: { type: ["MONTHLY_GRANT", "TOPUP_PURCHASE", "AI_USAGE", "REFUND", "ADJUSTMENT"] as const, required: true },
      amount: { type: "number", required: true }, // positive = credit added, negative = spent
      balanceAfter: { type: "number", required: true },
      description: { type: "string" },
      stripeEventId: { type: "string" },
      metadata: { type: "any" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // A user's credit history, newest first (prisma: @@index([userId])).
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "CREDIT#${createdAt}#${id}" },
      },
      // Idempotency lookup by Stripe event id (prisma: @@index([stripeEventId])) — only
      // populated when stripeEventId is set (grantTopup's webhook-driven path).
      byStripeEvent: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["stripeEventId"], template: "STRIPEEVENT#${stripeEventId}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "CREDIT#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const SellerLedgerEntry = new Entity(
  {
    model: { entity: "sellerLedgerEntry", version: "1", service: "plexoLedger" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      type: { type: ["SALE_CREDIT", "WITHDRAWAL_DEBIT", "WITHDRAWAL_REVERSAL"] as const, required: true },
      grossAmountCents: { type: "number" },
      feeCents: { type: "number" },
      netAmountCents: { type: "number", required: true },
      balanceAfterCents: { type: "number", required: true },
      templatePurchaseId: { type: "string" },
      withdrawalRequestId: { type: "string" },
      description: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // A seller's payout history, newest first (prisma: @@index([userId])).
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "SELLERLEDGER#${createdAt}#${id}" },
      },
      // Entries tied to a specific withdrawal — debit + any later reversal (prisma:
      // @@index([withdrawalRequestId])). Chosen over templatePurchaseId as the one GSI
      // this table gets for now: withdrawal reversal lookups are the operationally
      // important cross-user query; a templatePurchaseId GSI can be added later if a
      // real access pattern needs it, per the "don't pre-provision GSIs" convention.
      byWithdrawal: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["withdrawalRequestId"], template: "WITHDRAWAL#${withdrawalRequestId}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "SELLERLEDGER#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const WithdrawalRequest = new Entity(
  {
    model: { entity: "withdrawalRequest", version: "1", service: "plexoLedger" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      amountCents: { type: "number", required: true },
      encryptedAccountNumber: { type: "string", required: true },
      encryptedAccountHolderName: { type: "string", required: true },
      bankName: { type: "string", required: true },
      status: { type: ["PENDING", "PROCESSED", "REJECTED"] as const, default: "PENDING" },
      rejectionReason: { type: "string" },
      requestedAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      processedAt: { type: "string" },
      processedByAdminId: { type: "string" },
    },
    indexes: {
      // A user's own withdrawal history (prisma: @@index([userId])).
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: ["requestedAt", "id"], template: "WITHDRAWAL#${requestedAt}#${id}" },
      },
      // The admin review queue — "all PENDING withdrawals across every user" (prisma:
      // @@index([status])). Exactly the kind of cross-user admin query DynamoDB needs a
      // GSI for; this is plexo-admin's withdrawals dashboard route.
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "WDSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["requestedAt", "id"], template: "WITHDRAWAL#${requestedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Pure idempotency-claim record for Stripe webhook processing — mirrors
// app/api/webhooks/stripe/route.ts's claimStripeEvent (insert-first, unique-violation-
// means-already-processed). No TTL: this is an audit trail, not a cache.
export const StripeEvent = new Entity(
  {
    model: { entity: "stripeEvent", version: "1", service: "plexoLedger" },
    attributes: {
      id: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["id"], template: "STRIPEEVENT#${id}" },
        sk: { field: "sk", composite: [], template: "STRIPEEVENT" },
      },
    },
  },
  { table, client: docClient },
);

export const PaystackWebhookEvent = new Entity(
  {
    model: { entity: "paystackWebhookEvent", version: "1", service: "plexoLedger" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      receivedAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["id"], template: "PAYSTACKEVENT#${id}" },
        sk: { field: "sk", composite: [], template: "PAYSTACKEVENT" },
      },
      // Org-scoped listing for support/debugging (prisma: @@index([organizationId])).
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["receivedAt", "id"], template: "PAYSTACKEVENT#${receivedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoLedgerService = new Service(
  { CreditLedgerEntry, SellerLedgerEntry, WithdrawalRequest, StripeEvent, PaystackWebhookEvent },
  { table, client: docClient },
);
