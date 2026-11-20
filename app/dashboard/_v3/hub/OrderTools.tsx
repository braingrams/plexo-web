"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useState } from "react";
import { Mail, RotateCcw, Trash2 } from "lucide-react";
import { Button, Input, Textarea } from "../ui";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { errMsg, hubApi } from "./hubApi";

export type OrderDownload = { id: string; productName: string; deliveredAt: string | null; downloadCount: number; maxDownloads: number | null; resendCount: number };

/** The extra things an order carries beyond its basics (the orders list already returns them). */
export type OrderExtras = {
  orderNumber: number | string;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED";
  paymentMethod?: string;
  amountMinor: number;
  currency?: string;
  customerName?: string | null;
  booking?: { scheduledStart: string; status: string } | null;
  digitalDeliveries?: OrderDownload[];
  deliveryDetails?: [string, string][];
  refundReason?: string | null;
  refundedAt?: string | null;
  bankTransferRejectReason?: string | null;
  deleteBlocker?: string | null;
};

/** Does what the owner typed match the order number (the server checks it again)? */
export function orderNumberMatches(typed: string, orderNumber: number | string): boolean {
  return typed.trim().toUpperCase() === String(orderNumber).toUpperCase();
}

/** What the owner needs besides "what's happening": where it goes, the booking, download links, refund and delete. */
export function OrderMore<T extends OrderExtras & { id: string }>({ siteId, order, currency, onChange, onDeleted }: { siteId: string; order: T; currency: string; onChange: (patch: Partial<T>) => void; onDeleted: () => void }) {
  const [panel, setPanel] = useState<null | "refund" | "delete">(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cur = order.currency ?? currency;
  const amount = formatMoney(order.amountMinor, cur);
  const bank = order.paymentMethod === "BANK_TRANSFER";
  const base = `/api/v1/commerce/${siteId}/orders/${order.id}`;
  const details = order.deliveryDetails ?? [];
  const downloads = order.digitalDeliveries ?? [];

  const close = () => {
    setPanel(null);
    setReason("");
    setTyped("");
    setSure(false);
    setError(null);
  };

  async function resend(d: OrderDownload) {
    setBusy(d.id);
    setError(null);
    try {
      await hubApi(`${base}/resend-digital-delivery`, { method: "POST", json: { deliveryId: d.id } }, "We couldn't send the link again. Please try again.");
      onChange({ digitalDeliveries: downloads.map((x) => (x.id === d.id ? { ...x, resendCount: x.resendCount + 1 } : x)) } as unknown as Partial<T>);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function refund() {
    setBusy("refund");
    setError(null);
    try {
      const r = await hubApi<{ order?: { refundReason?: string; refundedAt?: string } }>(`${base}/refund`, { method: "POST", json: { reason, confirmOrderNumber: typed } }, "We couldn't refund this order. Please try again.");
      onChange({ status: "REFUNDED", refundReason: r.order?.refundReason ?? reason, refundedAt: r.order?.refundedAt ?? new Date().toISOString() } as unknown as Partial<T>);
      close();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      await hubApi(base, { method: "DELETE", json: { confirmOrderNumber: typed } }, "We couldn't delete this order. Please try again.");
      onDeleted();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const matches = orderNumberMatches(typed, order.orderNumber);
  const canRefund = order.status === "PAID";

  return (
    <div className="plx-form">
      {order.booking ? (
        <div className="plx-inlinemsg">
          <div>
            <b>Booked for</b> {new Date(order.booking.scheduledStart).toLocaleString("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </div>
        </div>
      ) : null}
      {details.length > 0 ? (
        <div>
          <p className="plx-h3" style={{ marginBottom: 8 }}>Where it goes</p>
          <dl className="plx-kv">
            {details.map(([k, v]) => (
              <div key={k} className="plx-kv__row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {downloads.length > 0 ? (
        <div>
          <p className="plx-h3" style={{ marginBottom: 8 }}>Downloads they bought</p>
          <ul className="plx-list" style={{ border: "1px solid var(--plx-border)", borderRadius: 14 }}>
            {downloads.map((d) => (
              <li key={d.id} className="plx-hrow" style={{ minHeight: 56, padding: "10px 16px" }}>
                <span className="plx-hrow__main">
                  <span className="plx-hrow__title">{d.productName}</span>
                  <span className="plx-hrow__sub">
                    {d.deliveredAt ? `Sent ${new Date(d.deliveredAt).toLocaleDateString()}` : "Not sent yet"} · opened {d.downloadCount}
                    {d.maxDownloads ? ` of ${d.maxDownloads}` : ""} time{d.downloadCount === 1 ? "" : "s"}
                  </span>
                </span>
                <Button size="sm" variant="secondary" leftIcon={<Mail size={16} aria-hidden />} loading={busy === d.id} onClick={() => resend(d)}>
                  Send link again
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {order.status === "REFUNDED" && order.refundReason ? (
        <p className="plx-small">
          Refunded{order.refundedAt ? ` on ${new Date(order.refundedAt).toLocaleDateString()}` : ""}. Reason: “{order.refundReason}”
        </p>
      ) : null}

      {panel === null ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {canRefund ? (
            <Button variant="secondary" size="sm" leftIcon={<RotateCcw size={16} aria-hidden />} onClick={() => setPanel("refund")}>
              Refund this order
            </Button>
          ) : null}
          {order.deleteBlocker ? (
            <span className="plx-small">{order.deleteBlocker}</span>
          ) : (
            <Button variant="ghost" size="sm" leftIcon={<Trash2 size={16} aria-hidden />} onClick={() => setPanel("delete")} style={{ color: "var(--plx-danger)" }}>
              Delete this order
            </Button>
          )}
        </div>
      ) : panel === "refund" ? (
        <div className="plx-inlinemsg plx-inlinemsg--bad" style={{ flexDirection: "column" }}>
          <b>Refund {amount}</b>
          <span>
            {bank
              ? `They paid by bank transfer, so we can't send the money back for you. Send ${amount} back to them yourself first, then mark the order as refunded. We'll email them.`
              : `${amount} goes back to the way they paid, and we email them. This can't be undone.`}{" "}
            Stock and booked times are not put back automatically.
          </span>
          <Textarea label="Why are you refunding it?" help="At least a few words. We keep this with the order." value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} placeholder="For example: it arrived damaged" />
          <Input label={`Type ${order.orderNumber} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          <label className="plx-toggle">
            <span>{bank ? `I've already sent ${amount} back to them.` : "I understand this refund is final."}</span>
            <input type="checkbox" className="plx-switch" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="danger" loading={busy === "refund"} disabled={reason.trim().length < 5 || !matches || !sure} onClick={refund}>
              {bank ? "Mark as refunded" : `Refund ${amount}`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="plx-inlinemsg plx-inlinemsg--bad" style={{ flexDirection: "column" }}>
          <b>Delete order {order.orderNumber} for good?</b>
          <span>
            It can&apos;t be brought back. The order and {order.customerName ?? "the customer"}&apos;s details are removed from your shop.
            {order.status === "PAID" ? ` Your sales total will no longer include ${amount}.` : ""}
            {downloads.length > 0 ? " Download links they were sent will stop working." : ""}
            {order.booking ? " Its booked time becomes free again." : ""} They are not told.
          </span>
          <Input label={`Type ${order.orderNumber} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          <label className="plx-toggle">
            <span>I understand this can&apos;t be undone.</span>
            <input type="checkbox" className="plx-switch" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={close}>Keep order</Button>
            <Button variant="danger" loading={busy === "delete"} disabled={!matches || !sure} onClick={remove}>
              Delete for good
            </Button>
          </div>
        </div>
      )}
      {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
    </div>
  );
}
