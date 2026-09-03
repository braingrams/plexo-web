import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/server/authDynamo";
import { User, PlatformSettings } from "@/lib/db/coreEntities";
import { SellerLedgerEntry, WithdrawalRequest } from "@/lib/db/ledgerEntities";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { Card } from "@/app/dashboard/_components/Card";
import { PageContainer } from "@/app/dashboard/_components/PageContainer";
import { WithdrawalForm } from "./WithdrawalForm";

const STATUS_COLOR: Record<string, string> = {
  PENDING: "#f59e0b",
  PROCESSED: "#34d399",
  REJECTED: "#f87171",
};

export default async function PayoutsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/marketplace/payouts");
  }

  const [{ data: user }, { data: sales }, { data: withdrawals }, { data: platformSettings }] = await Promise.all([
    User.get({ id: session.user.id }).go(),
    SellerLedgerEntry.query.primary({ userId: session.user.id }).go({ order: "desc", limit: 25 }),
    WithdrawalRequest.query.primary({ userId: session.user.id }).go({ order: "desc" }),
    PlatformSettings.get({}).go(),
  ]);
  if (!user) throw new Error(`Session user ${session.user.id} has no matching User record`);

  const sellerBalanceCents = user.sellerBalanceCents ?? 0;
  const balance = (sellerBalanceCents / 100).toFixed(2);
  const feeBps = platformSettings?.marketplaceFeeBps ?? 2000;
  const feePercent = (feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : 2);
  const keepPercent = ((10_000 - feeBps) / 100).toFixed(feeBps % 100 === 0 ? 0 : 2);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Marketplace"
        title="Payouts"
        subtitle="Your marketplace earnings and withdrawal history."
        action={
          // Different wallet — a site's own Commerce sales (Platform Paystack/Stripe) live
          // separately per-site, not here. Cross-linked from Commerce's own Wallet page too.
          <Link
            href="/dashboard/commerce"
            style={{
              fontSize: "0.78rem", fontWeight: 600, color: "rgba(240,242,255,0.6)",
              textDecoration: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
              padding: "0.45rem 0.8rem", background: "rgba(255,255,255,0.03)", whiteSpace: "nowrap",
            }}
          >
            Commerce site earnings →
          </Link>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem", marginBottom: "2rem" }}>
        <Card>
          <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(240,242,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Available balance
          </span>
          <h2 style={{ fontSize: "2rem", fontWeight: 800, color: "#f0f2ff", margin: "0.35rem 0 0" }}>${balance}</h2>
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", marginTop: "0.5rem" }}>
            You keep {keepPercent}% of every sale — Plexo takes a {feePercent}% platform fee.
          </p>
        </Card>

        <WithdrawalForm availableCents={sellerBalanceCents} />
      </div>

      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.75rem" }}>Withdrawal history</h2>
      {withdrawals.length === 0 ? (
        <Card>
          <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.6)" }}>No withdrawal requests yet.</p>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}>
          {withdrawals.map((w) => (
            <Card key={w.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>
                  ${(w.amountCents / 100).toFixed(2)} — {w.bankName}
                </p>
                <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
                  Requested {new Date(w.requestedAt).toLocaleDateString()}
                  {w.processedAt ? ` · Processed ${new Date(w.processedAt).toLocaleDateString()}` : ""}
                </p>
                {w.status === "REJECTED" && w.rejectionReason && (
                  <p style={{ fontSize: "0.78rem", color: "#f87171", margin: "0.5rem 0 0" }}>Rejected: {w.rejectionReason}</p>
                )}
              </div>
              <span style={{
                flexShrink: 0, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", padding: "0.3rem 0.65rem", borderRadius: 999,
                background: "rgba(255,255,255,0.05)", color: STATUS_COLOR[w.status ?? "PENDING"],
              }}>
                {w.status ?? "PENDING"}
              </span>
            </Card>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.75rem" }}>Ledger</h2>
      {sales.length === 0 ? (
        <Card>
          <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.6)" }}>No activity yet.</p>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {sales.map((entry) => (
            <div key={entry.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
              padding: "0.75rem 1rem", borderRadius: 10,
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
            }}>
              <span style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.7)" }}>
                {entry.description ?? entry.type}
              </span>
              <span style={{ fontSize: "0.85rem", fontWeight: 700, color: entry.netAmountCents >= 0 ? "#34d399" : "#f87171" }}>
                {entry.netAmountCents >= 0 ? "+" : ""}${(entry.netAmountCents / 100).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
