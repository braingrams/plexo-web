"use client";

import { useState } from "react";

type Status = "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED";

export function BankTransferConfirmClient({
  site, orderId, token, amount, initialStatus, dashboardUrl,
}: {
  site: string;
  orderId: string;
  token: string;
  amount: string;
  initialStatus: Status;
  dashboardUrl: string;
}) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "confirm" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/commerce/bank-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, order: orderId, token, action, reason: action === "reject" ? reason : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't update this order.");
      setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update this order.");
    } finally {
      setBusy(false);
    }
  }

  if (status !== "PENDING") {
    const paid = status === "PAID";
    return (
      <div className="text-center">
        <p className={`text-sm font-semibold mb-1 ${paid ? "text-emerald-400" : "text-slate-300"}`}>
          {paid ? "Payment confirmed — the order is now marked paid." : `This order is ${status.toLowerCase()}.`}
        </p>
        <p className="text-xs text-slate-500 mb-5">
          {paid ? "Your customer has been emailed their order confirmation. Fulfil it from your Orders page." : "The customer has been told, and any reserved stock was released."}
        </p>
        <a href={dashboardUrl} className="text-sm font-semibold text-purple-400 hover:text-purple-300">Open Orders →</a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!rejecting ? (
        <>
          <button
            type="button" disabled={busy} onClick={() => void submit("confirm")}
            className="w-full rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 py-3 text-sm font-bold disabled:opacity-60"
          >
            {busy ? "Confirming…" : `Yes, I received ${amount}`}
          </button>
          <button
            type="button" disabled={busy} onClick={() => setRejecting(true)}
            className="w-full rounded-xl border border-white/10 py-3 text-sm font-semibold text-slate-300 disabled:opacity-60"
          >
            I didn&apos;t receive it
          </button>
        </>
      ) : (
        <>
          <label className="block text-xs font-semibold text-slate-300">
            Note to the customer (optional)
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500}
              placeholder="e.g. No transfer with this reference reached our account."
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.04] p-2.5 text-sm text-white outline-none"
            />
          </label>
          <p className="text-xs text-slate-500">The order will be cancelled, its stock released, and the customer emailed.</p>
          <button
            type="button" disabled={busy} onClick={() => void submit("reject")}
            className="w-full rounded-xl border border-red-500/30 bg-red-500/10 py-3 text-sm font-bold text-red-400 disabled:opacity-60"
          >
            {busy ? "Cancelling…" : "Cancel order — payment not received"}
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(false)} className="w-full py-2 text-xs text-slate-400">
            Go back
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-400 text-center">{error}</p>}
    </div>
  );
}
