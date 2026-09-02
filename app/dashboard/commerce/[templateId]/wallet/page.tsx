import { EntityItem } from "electrodb";
import { Template } from "@/lib/db/contentEntities";
import { Organization } from "@/lib/db/coreEntities";
import { CommerceWallet, CommerceWalletLedgerEntry, CommerceWithdrawalRequest } from "@/lib/db/commerceEntities";
import { WalletClient } from "./WalletClient";

export default async function CommerceWalletPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const { data: site } = await Template.get({ id: templateId }).go();
  if (!site) {
    return null;
  }

  const { data: org } = await Organization.get({ id: site.organizationId }).go();
  const pooled = org?.commerceWalletPooled ?? false;
  const { data: wallet } = await CommerceWallet.get({ scopeId: pooled ? site.organizationId : templateId }).go();

  const { data: ledger } = wallet
    ? await CommerceWalletLedgerEntry.query.primary({ walletId: wallet.id }).go({ limit: 26, order: "desc" })
    : { data: [] as EntityItem<typeof CommerceWalletLedgerEntry>[] };

  const { data: withdrawals } = wallet
    ? await CommerceWithdrawalRequest.query.primary({ walletId: wallet.id }).go({ order: "desc" })
    : { data: [] as EntityItem<typeof CommerceWithdrawalRequest>[] };

  return (
    <WalletClient
      templateId={templateId}
      initial={{
        balanceCents: wallet?.balanceCents ?? 0,
        currency: wallet?.currency ?? "NGN",
        pooled,
        ledger: ledger.slice(0, 25).map((e) => ({
          id: e.id,
          type: e.type,
          grossAmountCents: e.grossAmountCents ?? null,
          feeCents: e.feeCents ?? null,
          netAmountCents: e.netAmountCents,
          balanceAfterCents: e.balanceAfterCents,
          description: e.description ?? null,
          createdAt: e.createdAt ?? new Date().toISOString(),
        })),
        nextCursor: ledger.length > 25 ? ledger[24].id : null,
        withdrawals: withdrawals.map((w) => ({
          id: w.id,
          amountCents: w.amountCents,
          bankName: w.bankName,
          status: w.status ?? "PENDING",
          rejectionReason: w.rejectionReason ?? null,
          requestedAt: w.requestedAt ?? new Date().toISOString(),
          processedAt: w.processedAt ?? null,
        })),
      }}
    />
  );
}
