"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/app/dashboard/_components/Card";

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  color: "#f0f2ff",
  padding: "0.65rem 0.85rem",
  fontSize: "0.85rem",
  outline: "none",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#c5cbe8",
  marginBottom: "0.35rem",
};

export function WithdrawalForm({ availableCents }: { availableCents: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const availableUsd = (availableCents / 100).toFixed(2);
  const disabled = availableCents <= 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const amountCents = Math.round(Number(amount) * 100);
    if (!amountCents || amountCents <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (amountCents > availableCents) {
      setError("Amount exceeds your available balance.");
      return;
    }
    if (!accountNumber.trim() || !accountHolderName.trim() || !bankName.trim()) {
      setError("Account number, account holder name, and bank name are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/marketplace/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, accountNumber, accountHolderName, bankName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to submit withdrawal request.");
      setSuccess(true);
      setAmount("");
      setAccountNumber("");
      setAccountHolderName("");
      setBankName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit withdrawal request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "1rem" }}>Request a withdrawal</p>
      {disabled ? (
        <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.45)" }}>
          You don&apos;t have any balance available to withdraw yet.
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.85rem" }}>
          <label style={{ display: "block" }}>
            <span style={labelStyle}>Amount (USD, up to ${availableUsd})</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={availableUsd}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </label>
          <label style={{ display: "block" }}>
            <span style={labelStyle}>Account holder name</span>
            <input value={accountHolderName} onChange={(e) => setAccountHolderName(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "block" }}>
            <span style={labelStyle}>Account number</span>
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "block" }}>
            <span style={labelStyle}>Bank name</span>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} style={inputStyle} />
          </label>

          {error && <p style={{ color: "#f87171", fontSize: "0.8rem", margin: 0 }}>{error}</p>}
          {success && <p style={{ color: "#34d399", fontSize: "0.8rem", margin: 0 }}>Withdrawal requested — we'll review it shortly.</p>}

          <button
            type="submit"
            disabled={submitting}
            style={{
              background: submitting ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg, var(--brand), var(--brand-deep))",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "0.65rem 1.2rem",
              fontSize: "0.85rem",
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Submitting…" : "Request withdrawal"}
          </button>
        </form>
      )}
    </Card>
  );
}
