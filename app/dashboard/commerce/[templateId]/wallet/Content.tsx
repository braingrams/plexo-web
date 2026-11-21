import { EntityItem } from "electrodb";
import { Template } from "@/lib/db/contentEntities";
import { Organization } from "@/lib/db/coreEntities";
import { CommerceSettings, CommerceWallet, CommerceWalletLedgerEntry, CommerceWithdrawalRequest } from "@/lib/db/commerceEntities";
import { paginate, parsePageRequest } from "@/lib/pagination";
import { WalletClient } from "./WalletClient";
import { MoneyPanel } from "@/app/dashboard/_v3/hub/shop/MoneyPanel";

export async function WalletContent({ templateId, searchParams, hub, store }: { templateId: string; searchParams?: Record<string, string | string[] | undefined>; /** Inside the site hub: show the new "Your money" screen. */ hub?: boolean; store?: boolean }) {

  const { data: site } = await Template.get({ id: templateId }).go();
  if (!site) {
    return null;
  }

  const [{ data: org }, { data: settings }] = await Promise.all([
    Organization.get({ id: site.organizationId }).go(),
    CommerceSettings.get({ templateId }).go(),
  ]);
  const pooled = org?.commerceWalletPooled ?? false;
  const { data: wallet } = await CommerceWallet.get({ scopeId: pooled ? site.organizationId : templateId }).go();

  const { data: allLedger } = wallet
    ? await CommerceWalletLedgerEntry.query.primary({ walletId: wallet.id }).go({ pages: "all", order: "desc" })
    : { data: [] as EntityItem<typeof CommerceWalletLedgerEntry>[] };
  const { items: ledger, total: ledgerTotal, page: ledgerPage, pageSize: ledgerPageSize } = paginate(allLedger, parsePageRequest(searchParams ?? {}));

  const { data: withdrawals } = wallet
    ? await CommerceWithdrawalRequest.query.primary({ walletId: wallet.id }).go({ order: "desc" })
    : { data: [] as EntityItem<typeof CommerceWithdrawalRequest>[] };

  // The wallet only accrues money for Plexo-hosted payments (Platform Paystack/Stripe) — a
  // BYO-keys site's money never touches it (see the BYO Stripe webhook's own comment on
  // never calling creditCommerceWallet). So it's only relevant to show when: Commerce is on
  // and the site is currently Plexo-hosted, OR — regardless of the CURRENT provider — this
  // wallet actually has money or history, since a site that switched away from Plexo-hosted
  // payments after using them still needs to see and withdraw what it already earned.
  const isPlatformProvider = settings?.paymentProvider === "PLATFORM_PAYSTACK" || settings?.paymentProvider === "PLATFORM_STRIPE";
  const hasWalletHistory = Boolean(wallet) && ((wallet?.balanceCents ?? 0) > 0 || ledgerTotal > 0 || withdrawals.length > 0);
  const paymentsActive = Boolean(settings?.enabled || settings?.donationsEnabled);
  const showWallet = paymentsActive && (isPlatformProvider || hasWalletHistory);

  const Screen = hub ? MoneyPanel : WalletClient;
  return (
    <Screen
      templateId={templateId}
      initial={{
        showWallet,
        commerceEnabled: paymentsActive,
        store: store ?? (settings?.enabled ?? false),
        balanceCents: wallet?.balanceCents ?? 0,
        currency: settings?.currency || wallet?.currency || "USD",
        pooled,
        ledger: ledger.map((e) => ({
          id: e.id,
          type: e.type,
          grossAmountCents: e.grossAmountCents ?? null,
          feeCents: e.feeCents ?? null,
          netAmountCents: e.netAmountCents,
          balanceAfterCents: e.balanceAfterCents,
          description: e.description ?? null,
          createdAt: e.createdAt ?? new Date().toISOString(),
        })),
        ledgerTotal,
        ledgerPage,
        ledgerPageSize,
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
