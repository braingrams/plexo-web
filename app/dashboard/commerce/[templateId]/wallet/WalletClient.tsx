"use client";

import { useState } from "react";

type LedgerEntry = {
  id: string;
  type: "SALE_CREDIT" | "WITHDRAWAL_DEBIT" | "WITHDRAWAL_REVERSAL";
  grossAmountCents: number | null;
  feeCents: number | null;
  netAmountCents: number;
  balanceAfterCents: number;
  description: string | null;
  createdAt: string;
};

type Withdrawal = {
  id: string;
  amountCents: number;
  bankName: string;
  status: "PENDING" | "PROCESSED" | "REJECTED";
  rejectionReason: string | null;
  requestedAt: string;
  processedAt: string | null;
};

type InitialWallet = {
  balanceCents: number;
  currency: string;
  pooled: boolean;
  ledger: LedgerEntry[];
  nextCursor: string | null;
  withdrawals: Withdrawal[];
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.6rem 0.8rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem", marginBottom: "1.25rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>{title}</h2>
      {description && <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", margin: "0.3rem 0 1rem" }}>{description}</p>}
      <div style={{ display: "grid", gap: "0.9rem", marginTop: description ? 0 : "1rem" }}>{children}</div>
    </div>
  );
}

function formatMoney(cents: number, currency: string): string {
  const amount = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = currency === "NGN" ? "₦" : currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${amount}`;
}

const LEDGER_LABEL: Record<LedgerEntry["type"], string> = {
  SALE_CREDIT: "Sale",
  WITHDRAWAL_DEBIT: "Withdrawal",
  WITHDRAWAL_REVERSAL: "Withdrawal reversed",
};

export function WalletClient({ templateId, initial }: { templateId: string; initial: InitialWallet }) {
  const [balanceCents, setBalanceCents] = useState(initial.balanceCents);
  const [pooled, setPooled] = useState(initial.pooled);
  const [ledger, setLedger] = useState(initial.ledger);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [withdrawals, setWithdrawals] = useState(initial.withdrawals);
  const [loadingMore, setLoadingMore] = useState(false);
  const [togglingPooled, setTogglingPooled] = useState(false);

  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/wallet?cursor=${nextCursor}`);
      const data = await res.json();
      if (res.ok) {
        setLedger((prev) => [...prev, ...data.ledger]);
        setNextCursor(data.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleTogglePooled(next: boolean) {
    setTogglingPooled(true);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/wallet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pooled: next }),
      });
      if (res.ok) {
        setPooled(next);
        const refreshed = await fetch(`/api/v1/commerce/${templateId}/wallet`).then((r) => r.json());
        setBalanceCents(refreshed.wallet.balanceCents);
        setLedger(refreshed.ledger);
        setNextCursor(refreshed.nextCursor);
      }
    } finally {
      setTogglingPooled(false);
    }
  }

  async function handleWithdraw() {
    setMessage(null);
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setMessage({ kind: "error", text: "Enter a valid amount." });
      return;
    }
    if (!accountNumber.trim() || !accountHolderName.trim() || !bankName.trim()) {
      setMessage({ kind: "error", text: "Account number, account holder name, and bank name are required." });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/wallet/withdrawals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, accountNumber, accountHolderName, bankName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't submit withdrawal request.");

      setBalanceCents((prev) => prev - amountCents);
      setWithdrawals((prev) => [{ id: data.withdrawal.id, amountCents, bankName, status: "PENDING", rejectionReason: null, requestedAt: new Date().toISOString(), processedAt: null }, ...prev]);
      setAmount("");
      setAccountNumber("");
      setAccountHolderName("");
      setBankName("");
      setShowWithdrawForm(false);
      setMessage({ kind: "success", text: "Withdrawal requested — it'll be processed by the Plexo team." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Couldn't submit withdrawal request." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: 0 }}>Wallet</h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginTop: 4 }}>
          Proceeds from Platform Paystack / Platform Stripe sales. Balance-tracking only — withdrawals are processed manually by the Plexo team.
        </p>
      </div>

      <Section title="Balance">
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "2rem", fontWeight: 800, color: "#f0f2ff", fontVariantNumeric: "tabular-nums" }}>
              {formatMoney(balanceCents, initial.currency)}
            </div>
            <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
              {pooled ? "Pooled across every site in this organization." : "This site's own wallet."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowWithdrawForm((v) => !v)}
            style={{ padding: "0.6rem 1.1rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Request withdrawal
          </button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: togglingPooled ? "not-allowed" : "pointer", marginTop: "0.4rem" }}>
          <input type="checkbox" checked={pooled} disabled={togglingPooled} onChange={(e) => void handleTogglePooled(e.target.checked)} style={{ width: 16, height: 16 }} />
          <span style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.55)" }}>
            Pool this organization's platform-hosted sales into one shared wallet, instead of a separate wallet per site.
          </span>
        </label>

        {message && (
          <p style={{ fontSize: "0.82rem", margin: 0, color: message.kind === "success" ? "#34d399" : "#f87171" }}>{message.text}</p>
        )}

        {showWithdrawForm && (
          <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.9rem", display: "grid", gap: "0.7rem" }}>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>Amount ({initial.currency})</span>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>Bank name</span>
              <input type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>Account number</span>
              <input type="text" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>Account holder name</span>
              <input type="text" value={accountHolderName} onChange={(e) => setAccountHolderName(e.target.value)} style={inputStyle} />
            </label>
            <button
              type="button"
              onClick={() => void handleWithdraw()}
              disabled={submitting}
              style={{ padding: "0.6rem 1rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", fontFamily: "inherit", justifySelf: "start" }}
            >
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </div>
        )}
      </Section>

      <Section title="Withdrawal requests">
        {withdrawals.length === 0 ? (
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: 0 }}>No withdrawal requests yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {withdrawals.map((w) => (
              <div key={w.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.6rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <span style={{ fontSize: "0.82rem", color: "#f0f2ff", fontVariantNumeric: "tabular-nums" }}>{formatMoney(w.amountCents, initial.currency)}</span>
                  <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginLeft: "0.5rem" }}>
                    {w.bankName} · {new Date(w.requestedAt).toLocaleDateString()}
                  </span>
                  {w.status === "REJECTED" && w.rejectionReason && (
                    <div style={{ fontSize: "0.72rem", color: "#f87171", marginTop: 2 }}>{w.rejectionReason}</div>
                  )}
                </div>
                <span
                  style={{
                    fontSize: "0.68rem", fontWeight: 700, borderRadius: 999, padding: "0.15rem 0.6rem", flexShrink: 0,
                    color: w.status === "PROCESSED" ? "#4ade80" : w.status === "REJECTED" ? "#f87171" : "#f59e0b",
                    background: w.status === "PROCESSED" ? "rgba(74,222,128,0.12)" : w.status === "REJECTED" ? "rgba(248,113,113,0.12)" : "rgba(245,158,11,0.12)",
                  }}
                >
                  {w.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Ledger">
        {ledger.length === 0 ? (
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: 0 }}>No activity yet.</p>
        ) : (
          <>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {ledger.map((entry) => (
                <div key={entry.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.6rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <div>
                    <span style={{ fontSize: "0.82rem", color: "#f0f2ff" }}>{LEDGER_LABEL[entry.type]}</span>
                    {entry.description && <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginLeft: "0.5rem" }}>{entry.description}</span>}
                    <div style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)" }}>{new Date(entry.createdAt).toLocaleString()}</div>
                  </div>
                  <span style={{ fontSize: "0.82rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: entry.netAmountCents >= 0 ? "#4ade80" : "#f87171", flexShrink: 0 }}>
                    {entry.netAmountCents >= 0 ? "+" : ""}{formatMoney(entry.netAmountCents, initial.currency)}
                  </span>
                </div>
              ))}
            </div>
            {nextCursor && (
              <button
                type="button"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
                style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.6)", fontSize: "0.78rem", cursor: loadingMore ? "not-allowed" : "pointer", fontFamily: "inherit", justifySelf: "start" }}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
