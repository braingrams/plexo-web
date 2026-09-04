import { randomUUID } from "node:crypto";
import { EntityItem } from "electrodb";
import { Organization, PlatformSettings } from "@/lib/db/coreEntities";
import { CommerceWallet, CommerceWalletLedgerEntry, CommerceOrder } from "@/lib/db/commerceEntities";

type OrderItem = EntityItem<typeof CommerceOrder>;

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * Resolves (creating if necessary) the CommerceWallet a site's platform-hosted
 * (PLATFORM_PAYSTACK/PLATFORM_STRIPE) sales should credit. Site-scoped by default
 * (scopeId = templateId), matching every other Commerce setting — unless the org has
 * opted into Organization.commerceWalletPooled, in which case every site under that org
 * shares one wallet (scopeId = organizationId). Unlike the Prisma version (whose
 * templateId-nullable @unique couldn't actually enforce "one pooled wallet per org" —
 * Postgres treats every NULL as distinct, needing an app-layer find-before-create check),
 * this keys by the single resolved scopeId so ElectroDB's own .create()
 * attribute_not_exists condition enforces uniqueness atomically — a real correctness
 * improvement, not just a port.
 */
export async function resolveCommerceWallet(templateId: string, organizationId: string): Promise<EntityItem<typeof CommerceWallet>> {
  const { data: org } = await Organization.get({ id: organizationId }).go();
  const pooled = org?.commerceWalletPooled ?? false;
  const scopeId = pooled ? organizationId : templateId;

  const { data: existing } = await CommerceWallet.get({ scopeId }).go();
  if (existing) return existing;

  try {
    await CommerceWallet.create({
      id: randomUUID(),
      organizationId,
      templateId: pooled ? undefined : templateId,
      scopeId,
    }).go();
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err; // lost the create race — another concurrent first sale beat us to it
  }
  const { data: created } = await CommerceWallet.get({ scopeId }).go();
  if (!created) throw new Error("Failed to resolve Commerce wallet.");
  return created;
}

/**
 * Credits a platform-hosted order's proceeds to the site's (or org's pooled) wallet, minus
 * PlatformSettings.commercePlatformFeeBps (0 by default — pure pass-through in v1). Mirrors
 * creditMarketplaceSeller's ledger pattern: balanceAfterCents is read back from the same
 * update so the ledger entry is always self-consistent even under concurrent credits —
 * here via an optimistic-concurrency retry loop (DynamoDB has no multi-item $transaction
 * with a read-modify-write like Prisma's, so the read-check-write has to be explicit).
 */
export async function creditCommerceWallet(order: OrderItem): Promise<void> {
  const [wallet, { data: platformSettings }] = await Promise.all([
    resolveCommerceWallet(order.templateId, order.organizationId),
    PlatformSettings.get({}).go(),
  ]);

  const feeBps = platformSettings?.commercePlatformFeeBps ?? 0;
  const feeCents = Math.round((order.amountMinor * feeBps) / 10000);
  const netCents = order.amountMinor - feeCents;

  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data: current } = await CommerceWallet.get({ scopeId: wallet.scopeId }).go();
    if (!current) throw new Error(`CommerceWallet ${wallet.scopeId} vanished during credit`);
    const nextBalance = (current.balanceCents ?? 0) + netCents;

    try {
      await CommerceWallet.patch({ scopeId: wallet.scopeId })
        .set({ balanceCents: nextBalance })
        .where((attr, op) => op.eq(attr.balanceCents, current.balanceCents ?? 0))
        .go();
    } catch (err) {
      if (isConditionalCheckFailure(err)) continue; // balance moved under us — retry against the fresh value
      throw err;
    }

    await CommerceWalletLedgerEntry.create({
      id: randomUUID(),
      walletId: wallet.id,
      type: "SALE_CREDIT",
      grossAmountCents: order.amountMinor,
      feeCents,
      netAmountCents: netCents,
      balanceAfterCents: nextBalance,
      orderId: order.id,
      description: `Order ${order.orderNumber}`,
    }).go();
    return;
  }
  throw new Error(`Failed to credit Commerce wallet ${wallet.scopeId} after ${MAX_RETRIES} attempts (concurrent writers).`);
}

export class InsufficientWalletBalanceError extends Error {}

/**
 * Debits a wallet to fund a domain purchase/renewal (see the Buy-a-Domain feature) — the
 * FIRST debit rail this wallet has ever had; every existing ledger entry only ever credits
 * it from a sale. Same optimistic-concurrency retry loop as creditCommerceWallet, plus a
 * pre-write sufficiency check (thrown as InsufficientWalletBalanceError so callers can
 * surface a clean 402-style error instead of a generic 500).
 *
 * There is no cross-item DynamoDB transaction tying this debit to the caller's own
 * subsequent RegisterDomain call (same accepted gap creditMarketplaceSeller's own comment
 * describes elsewhere) — callers MUST refund via creditCommerceWalletForDomainRefund if
 * registration fails after this succeeds. See lib/domains/refundDomainPurchase.ts.
 */
export async function debitCommerceWalletForDomain(
  wallet: EntityItem<typeof CommerceWallet>,
  amountCents: number,
  registeredDomainId: string,
  type: "DOMAIN_PURCHASE_DEBIT" | "DOMAIN_RENEWAL_DEBIT",
  description: string,
): Promise<void> {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data: current } = await CommerceWallet.get({ scopeId: wallet.scopeId }).go();
    if (!current) throw new Error(`CommerceWallet ${wallet.scopeId} vanished during debit`);
    const currentBalance = current.balanceCents ?? 0;
    if (currentBalance < amountCents) {
      throw new InsufficientWalletBalanceError(`Wallet balance (${currentBalance}) is less than the amount requested (${amountCents}).`);
    }
    const nextBalance = currentBalance - amountCents;

    try {
      await CommerceWallet.patch({ scopeId: wallet.scopeId })
        .set({ balanceCents: nextBalance })
        .where((attr, op) => op.eq(attr.balanceCents, currentBalance))
        .go();
    } catch (err) {
      if (isConditionalCheckFailure(err)) continue; // balance moved under us — retry against the fresh value (and re-check sufficiency)
      throw err;
    }

    await CommerceWalletLedgerEntry.create({
      id: randomUUID(),
      walletId: wallet.id,
      type,
      netAmountCents: -amountCents,
      balanceAfterCents: nextBalance,
      registeredDomainId,
      description,
    }).go();
    return;
  }
  throw new Error(`Failed to debit Commerce wallet ${wallet.scopeId} after ${MAX_RETRIES} attempts (concurrent writers).`);
}

/**
 * Credits a wallet back after a domain purchase/renewal debit turns out to be unfulfillable
 * (e.g. RegisterDomain failed after debitCommerceWalletForDomain already succeeded) — the
 * wallet-funded counterpart to lib/domains/refundDomainPurchase.ts's Stripe refund path.
 */
export async function creditCommerceWalletForDomainRefund(
  wallet: EntityItem<typeof CommerceWallet>,
  amountCents: number,
  registeredDomainId: string,
  description: string,
): Promise<void> {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data: current } = await CommerceWallet.get({ scopeId: wallet.scopeId }).go();
    if (!current) throw new Error(`CommerceWallet ${wallet.scopeId} vanished during refund`);
    const nextBalance = (current.balanceCents ?? 0) + amountCents;

    try {
      await CommerceWallet.patch({ scopeId: wallet.scopeId })
        .set({ balanceCents: nextBalance })
        .where((attr, op) => op.eq(attr.balanceCents, current.balanceCents ?? 0))
        .go();
    } catch (err) {
      if (isConditionalCheckFailure(err)) continue;
      throw err;
    }

    await CommerceWalletLedgerEntry.create({
      id: randomUUID(),
      walletId: wallet.id,
      type: "DOMAIN_REFUND_CREDIT",
      netAmountCents: amountCents,
      balanceAfterCents: nextBalance,
      registeredDomainId,
      description,
    }).go();
    return;
  }
  throw new Error(`Failed to refund Commerce wallet ${wallet.scopeId} after ${MAX_RETRIES} attempts (concurrent writers).`);
}
