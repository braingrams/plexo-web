import { prisma } from "@/server/prisma";
import { resolveCommerceWallet } from "@/lib/commerce/wallet";
import { WalletClient } from "./WalletClient";

export default async function CommerceWalletPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const site = await prisma.template.findUnique({ where: { id: templateId }, select: { organizationId: true } });
  if (!site) {
    return null;
  }

  const org = await prisma.organization.findUnique({ where: { id: site.organizationId }, select: { commerceWalletPooled: true } });
  const wallet = org?.commerceWalletPooled
    ? await prisma.commerceWallet.findFirst({ where: { organizationId: site.organizationId, templateId: null } })
    : await prisma.commerceWallet.findUnique({ where: { templateId } });

  const ledger = wallet
    ? await prisma.commerceWalletLedgerEntry.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: 26,
      })
    : [];

  const withdrawals = wallet
    ? await prisma.commerceWithdrawalRequest.findMany({
        where: { walletId: wallet.id },
        orderBy: { requestedAt: "desc" },
      })
    : [];

  return (
    <WalletClient
      templateId={templateId}
      initial={{
        balanceCents: wallet?.balanceCents ?? 0,
        currency: wallet?.currency ?? "NGN",
        pooled: Boolean(org?.commerceWalletPooled),
        ledger: ledger.slice(0, 25).map((e) => ({
          id: e.id,
          type: e.type,
          grossAmountCents: e.grossAmountCents,
          feeCents: e.feeCents,
          netAmountCents: e.netAmountCents,
          balanceAfterCents: e.balanceAfterCents,
          description: e.description,
          createdAt: e.createdAt.toISOString(),
        })),
        nextCursor: ledger.length > 25 ? ledger[24].id : null,
        withdrawals: withdrawals.map((w) => ({
          id: w.id,
          amountCents: w.amountCents,
          bankName: w.bankName,
          status: w.status,
          rejectionReason: w.rejectionReason,
          requestedAt: w.requestedAt.toISOString(),
          processedAt: w.processedAt ? w.processedAt.toISOString() : null,
        })),
      }}
    />
  );
}
