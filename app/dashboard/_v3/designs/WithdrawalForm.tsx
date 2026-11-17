"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, Notice } from "../ui";

/** Ask for your earnings to be paid into your bank account. Same request as before. */
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const amountCents = Math.round(Number(amount) * 100);
    if (!amountCents || amountCents <= 0) return setError("Please type how much you would like to withdraw, like 25.");
    if (amountCents > availableCents) return setError(`You can take out up to $${availableUsd} right now.`);
    if (!accountNumber.trim() || !accountHolderName.trim() || !bankName.trim()) return setError("Please fill in the name on the account, the account number and the bank name.");
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/marketplace/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, accountNumber, accountHolderName, bankName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "We could not send your request. Please try again.");
      setSuccess(true);
      setAmount("");
      setAccountNumber("");
      setAccountHolderName("");
      setBankName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not send your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card padding="lg">
      <CardHeader title="Take money out" description="We pay it into your bank account." />
      {availableCents <= 0 ? (
        <p className="plx-body" style={{ marginTop: 14 }}>
          Nothing to take out yet. When someone buys one of your designs, the money shows up here.
        </p>
      ) : (
        <form onSubmit={submit} className="plx-dzform" style={{ marginTop: 16 }} noValidate>
          <Input label="How much (US dollars)" help={`Up to $${availableUsd}`} type="number" inputMode="decimal" min="0.01" step="0.01" max={availableUsd} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          <Input label="Name on the bank account" value={accountHolderName} onChange={(e) => setAccountHolderName(e.target.value)} autoComplete="name" />
          <Input label="Account number" inputMode="numeric" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
          <Input label="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          {error ? <Notice kind="error" title="Check the form">{error}</Notice> : null}
          {success ? <Notice kind="success" title="Request sent">We will look at it shortly and let you know when it is paid.</Notice> : null}
          <div>
            <Button type="submit" loading={submitting} loadingLabel="Sending your request">
              Request payment
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
