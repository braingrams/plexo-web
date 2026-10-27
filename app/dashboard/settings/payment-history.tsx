"use client";

import { useState } from "react";

export type PaymentRow = {
  id: string;
  paidAt: string;
  description: string;
  detail: string | null;
  amountCents: number;
  refundedCents: number;
  currency: string;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  receiptNumber: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  failureReason: string | null;
};

export type BillingSummary = {
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  renewsAt: string | null;
  endsAt: string | null;
};

const BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", jcb: "JCB", diners: "Diners", unionpay: "UnionPay" };

const STATUS: Record<PaymentRow["status"], { label: string; color: string; bg: string }> = {
  PAID: { label: "Paid", color: "#4ade80", bg: "rgba(52,211,153,0.1)" },
  PENDING: { label: "Pending", color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  FAILED: { label: "Failed", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  REFUNDED: { label: "Refunded", color: "rgba(240,242,255,0.6)", bg: "rgba(255,255,255,0.06)" },
  PARTIALLY_REFUNDED: { label: "Partly refunded", color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
};

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

const buttonStyle: React.CSSProperties = {
  padding: "0.3rem 0.65rem",
  borderRadius: 8,
  fontSize: "0.72rem",
  fontWeight: 600,
  color: "#f0f2ff",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  cursor: "pointer",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

function EmailButton({ paymentId }: { paymentId: string }) {
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" | "error"; text?: string }>({ kind: "idle" });
  async function send() {
    setState({ kind: "sending" });
    try {
      const res = await fetch(`/api/billing/receipts/${encodeURIComponent(paymentId)}/email`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { to?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "We couldn't send that email. Please try again.");
      setState({ kind: "sent", text: `Sent to ${data.to}` });
    } catch (err) {
      setState({ kind: "error", text: err instanceof Error ? err.message : "We couldn't send that email." });
    }
  }
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <button type="button" onClick={() => void send()} disabled={state.kind === "sending"} style={{ ...buttonStyle, opacity: state.kind === "sending" ? 0.6 : 1 }}>
        {state.kind === "sending" ? "Sending…" : "Email me a copy"}
      </button>
      {state.text && <span style={{ fontSize: "0.68rem", color: state.kind === "error" ? "#f87171" : "#4ade80" }}>{state.text}</span>}
    </span>
  );
}

export function PaymentHistory({ payments, summary }: { payments: PaymentRow[]; summary: BillingSummary }) {
  const hasCard = !!summary.cardLast4;
  return (
    <div id="payments" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, overflow: "hidden", marginTop: "1.5rem" }}>
      <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>Payments &amp; receipts</h2>
        <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)" }}>Every payment you've made to Plexo. Download a receipt as a PDF, or have it emailed to you again.</p>
      </div>

      {(hasCard || summary.renewsAt || summary.endsAt) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", padding: "1rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {hasCard && (
            <div>
              <p style={{ fontSize: "0.68rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)" }}>Card on file</p>
              <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "#f0f2ff" }}>
                {BRANDS[summary.cardBrand ?? ""] ?? summary.cardBrand ?? "Card"} •••• {summary.cardLast4}
                {summary.cardExpMonth && summary.cardExpYear ? <span style={{ fontWeight: 400, color: "rgba(240,242,255,0.4)" }}> · expires {String(summary.cardExpMonth).padStart(2, "0")}/{String(summary.cardExpYear).slice(-2)}</span> : null}
              </p>
              <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.35)" }}>Change it under "Manage subscription" above.</p>
            </div>
          )}
          {summary.endsAt ? (
            <div>
              <p style={{ fontSize: "0.68rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)" }}>Subscription</p>
              <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "#fbbf24" }}>Cancelled — access until {date(summary.endsAt)}</p>
            </div>
          ) : summary.renewsAt ? (
            <div>
              <p style={{ fontSize: "0.68rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)" }}>Next payment</p>
              <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "#f0f2ff" }}>{date(summary.renewsAt)}</p>
            </div>
          ) : null}
        </div>
      )}

      {payments.length === 0 ? (
        <p style={{ padding: "1.25rem 1.5rem", fontSize: "0.82rem", color: "rgba(240,242,255,0.35)" }}>No payments yet. When you subscribe or buy credits, your receipts will appear here.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {payments.map((p) => {
            const status = STATUS[p.status];
            const settled = p.status === "PAID" || p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED";
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", padding: "0.9rem 1.5rem", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff" }}>{p.description}</p>
                  <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)" }}>
                    {date(p.paidAt)}
                    {p.detail ? ` · ${p.detail}` : ""}
                    {p.cardLast4 ? ` · •••• ${p.cardLast4}` : ""}
                    {p.receiptNumber ? ` · ${p.receiptNumber}` : ""}
                  </p>
                  {p.failureReason && <p style={{ fontSize: "0.72rem", color: "#f87171" }}>{p.failureReason}</p>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: "0.88rem", fontWeight: 700, color: "#f0f2ff" }}>{money(p.amountCents, p.currency)}</p>
                  <span style={{ display: "inline-block", fontSize: "0.65rem", fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 999, color: status.color, background: status.bg }}>{status.label}</span>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", minWidth: 190, justifyContent: "flex-end" }}>
                  {settled ? (
                    <>
                      <a href={`/api/billing/receipts/${encodeURIComponent(p.id)}`} style={buttonStyle}>Download PDF</a>
                      <EmailButton paymentId={p.id} />
                    </>
                  ) : (
                    <span style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.3)" }}>No receipt</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
