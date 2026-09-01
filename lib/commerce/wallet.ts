import type { CommerceOrder } from "@prisma/client";
import { prisma } from "@/server/prisma";

/**
 * Resolves (creating if necessary) the CommerceWallet a site's platform-hosted
 * (PLATFORM_PAYSTACK/PLATFORM_STRIPE) sales should credit. Site-scoped by default
 * (templateId set), matching every other Commerce setting — unless the org has opted into
 * Organization.commerceWalletPooled, in which case every site under that org shares one
 * wallet (templateId null). The DB doesn't enforce "at most one pooled wallet per org"
 * (Postgres treats each NULL templateId as distinct), so the pooled branch always looks for
 * an existing row before creating — never blindly upsert on templateId alone there.
 */
export async function resolveCommerceWallet(templateId: string, organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { commerceWalletPooled: true } });

  if (org?.commerceWalletPooled) {
    const existing = await prisma.commerceWallet.findFirst({ where: { organizationId, templateId: null } });
    if (existing) return existing;
    // Two concurrent first-ever platform sales for the same org could both reach here at
    // once — if creation loses a race to a P2002-style conflict, just re-fetch rather than
    // erroring; either row is the correct pooled wallet.
    try {
      return await prisma.commerceWallet.create({ data: { organizationId, templateId: null } });
    } catch {
      const retried = await prisma.commerceWallet.findFirst({ where: { organizationId, templateId: null } });
      if (retried) return retried;
      throw new Error("Failed to resolve pooled Commerce wallet.");
    }
  }

  return prisma.commerceWallet.upsert({
    where: { templateId },
    create: { organizationId, templateId },
    update: {},
  });
}

/**
 * Credits a platform-hosted order's proceeds to the site's (or org's pooled) wallet, minus
 * PlatformSettings.commercePlatformFeeBps (0 by default — pure pass-through in v1). Mirrors
 * creditMarketplaceSeller (app/api/webhooks/stripe/route.ts) exactly: one $transaction,
 * balanceAfterCents read back from the same update so the ledger entry is always
 * self-consistent even under concurrent credits.
 */
export async function creditCommerceWallet(order: CommerceOrder): Promise<void> {
  const [wallet, platformSettings] = await Promise.all([
    resolveCommerceWallet(order.templateId, order.organizationId),
    prisma.platformSettings.findUnique({ where: { id: "global" } }),
  ]);

  const feeBps = platformSettings?.commercePlatformFeeBps ?? 0;
  const feeCents = Math.round((order.amountMinor * feeBps) / 10000);
  const netCents = order.amountMinor - feeCents;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.commerceWallet.update({
      where: { id: wallet.id },
      data: { balanceCents: { increment: netCents } },
    });
    await tx.commerceWalletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        type: "SALE_CREDIT",
        grossAmountCents: order.amountMinor,
        feeCents,
        netAmountCents: netCents,
        balanceAfterCents: updated.balanceCents,
        orderId: order.id,
        description: `Order ${order.orderNumber}`,
      },
    });
  });
}
