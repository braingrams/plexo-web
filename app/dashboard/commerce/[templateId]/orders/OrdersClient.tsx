"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/commerce/formatMoney";

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED";
  fulfillmentStatus: "UNFULFILLED" | "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "COMPLETED";
  amountMinor: number;
  currency: string;
  customerEmail: string;
  customerName: string | null;
  createdAt: string;
  items: { nameSnapshot: string; quantity: number; unitPriceMinor: number }[];
  booking: { scheduledStart: string; status: string } | null;
  digitalDeliveries: DigitalDeliverySummary[];
  paymentMethod: "ONLINE" | "BANK_TRANSFER";
  // [label, value] rows — delivery/pickup, address, phone, and the site's own checkout
  // question answers (lib/commerce/bankTransfer.ts's orderDeliveryDetails).
  deliveryDetails: [string, string][];
  refundReason: string | null;
  refundedAt: string | null;
  bankTransferRejectReason: string | null;
  // Why this order can't be deleted (shown instead of the delete button), or null if it can.
  deleteBlocker: string | null;
};

/** How many delivery-info rows fit in the table cell before "+N more" (→ drawer). */
const DELIVERY_PREVIEW_ROWS = 5;

function isAwaitingTransfer(o: Pick<OrderSummary, "status" | "paymentMethod">) {
  return o.status === "PENDING" && o.paymentMethod === "BANK_TRANSFER";
}

export type DigitalDeliverySummary = {
  id: string;
  method: "FILE_DOWNLOAD" | "EXTERNAL_LINK" | "ACCESS_LIST";
  productName: string;
  deliveredAt: string | null;
  downloadCount: number;
  maxDownloads: number | null;
  resendCount: number;
};

const STATUS_COLORS: Record<OrderSummary["status"], string> = {
  PENDING: "#fbbf24",
  PAID: "#34d399",
  FAILED: "#f87171",
  REFUNDED: "#a78bfa",
  CANCELLED: "rgba(240,242,255,0.4)",
};

const FULFILLMENT_OPTIONS: OrderSummary["fulfillmentStatus"][] = ["UNFULFILLED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"];

function StatusPill({ status, awaitingTransfer }: { status: OrderSummary["status"]; awaitingTransfer?: boolean }) {
  const color = awaitingTransfer ? "#60a5fa" : STATUS_COLORS[status];
  return (
    <span style={{ fontSize: "0.7rem", fontWeight: 700, color, background: `${color}22`, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>
      {awaitingTransfer ? "CONFIRM TRANSFER" : status}
    </span>
  );
}

function DeliveryInfoCell({ rows, onShowAll }: { rows: [string, string][]; onShowAll: () => void }) {
  if (!rows.length) return <span style={{ color: "rgba(240,242,255,0.3)" }}>—</span>;
  const preview = rows.slice(0, DELIVERY_PREVIEW_ROWS);
  const more = rows.length - preview.length;
  return (
    <div style={{ display: "grid", gap: 2, maxWidth: 260 }}>
      {preview.map(([label, value], i) => (
        <div key={i} style={{ fontSize: "0.74rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`${label}: ${value}`}>
          <span style={{ color: "rgba(240,242,255,0.4)" }}>{label}:</span> <span style={{ color: "rgba(240,242,255,0.75)" }}>{value}</span>
        </div>
      ))}
      {more > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onShowAll(); }}
          style={{ justifySelf: "start", marginTop: 2, padding: "1px 8px", borderRadius: 999, border: "1px solid rgba(var(--brand-rgb),0.35)", background: "rgba(var(--brand-rgb),0.12)", color: "var(--brand-light)", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          +{more} more
        </button>
      )}
    </div>
  );
}

/** Full delivery info for one order — opened from a table cell's "+N more". */
function DeliveryInfoDrawer({ order, onClose }: { order: OrderSummary; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={`Delivery info for ${order.orderNumber}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.55)", display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: "min(100%, 420px)", height: "100%", overflowY: "auto", background: "#0d0f1a", borderLeft: "1px solid rgba(255,255,255,0.12)", padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.25rem" }}>
          <div>
            <div style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Delivery info</div>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 800, color: "#f0f2ff", margin: "2px 0 0" }}>{order.orderNumber}</h2>
            <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.55)", marginTop: 4 }}>{order.customerName ?? "—"} · {order.customerEmail}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "none", cursor: "pointer", color: "rgba(240,242,255,0.5)", padding: "0.4rem", borderRadius: 8 }}>✕</button>
        </div>
        <DeliveryDetailsList rows={order.deliveryDetails} />
      </div>
    </div>
  );
}

function DeliveryDetailsList({ rows }: { rows: [string, string][] }) {
  if (!rows.length) return <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.45)" }}>No delivery details on this order.</p>;
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "0.4rem 1rem" }}>
      {rows.map(([label, value], i) => (
        <div key={i} style={{ display: "flex", gap: "0.8rem", padding: "0.5rem 0", borderTop: i ? "1px solid rgba(255,255,255,0.06)" : "none", fontSize: "0.82rem" }}>
          <span style={{ flex: "0 0 38%", color: "rgba(240,242,255,0.45)" }}>{label}</span>
          <span style={{ flex: 1, minWidth: 0, color: "#e2e4f5", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

export function OrdersClient({ templateId, initialOrders }: { templateId: string; initialOrders: OrderSummary[]; initialTotal: number }) {
  const [orders, setOrders] = useState(initialOrders);
  const [selected, setSelected] = useState<OrderSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [drawerOrder, setDrawerOrder] = useState<OrderSummary | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundConfirmNumber, setRefundConfirmNumber] = useState("");
  const [refundAcknowledged, setRefundAcknowledged] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmNumber, setDeleteConfirmNumber] = useState("");
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function openOrder(order: OrderSummary | null) {
    setSelected(order);
    setActionError(null);
    setMoreOpen(false);
    setRefundOpen(false);
    setRefundReason("");
    setRefundConfirmNumber("");
    setRefundAcknowledged(false);
    setRejectOpen(false);
    setRejectReason("");
    setDeleteOpen(false);
    setDeleteConfirmNumber("");
    setDeleteAcknowledged(false);
  }

  function patchOrder(id: string, patch: Partial<OrderSummary>) {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }

  async function runSearch() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter === "AWAITING_TRANSFER") {
        params.set("status", "PENDING");
        params.set("paymentMethod", "BANK_TRANSFER");
      } else if (statusFilter) params.set("status", statusFilter);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/v1/commerce/${templateId}/orders?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setOrders(
          data.orders.map((o: any) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            fulfillmentStatus: o.fulfillmentStatus,
            amountMinor: o.amountMinor,
            currency: o.currency ?? "NGN",
            customerEmail: o.customerEmail,
            customerName: o.customerName,
            createdAt: o.createdAt,
            items: o.items,
            booking: o.booking,
            digitalDeliveries: (o.digitalDeliveries ?? []).map((d: any) => ({
              id: d.id,
              method: d.method,
              productName: d.product?.name ?? "",
              deliveredAt: d.deliveredAt,
              downloadCount: d.downloadCount,
              maxDownloads: d.maxDownloads,
              resendCount: d.resendCount,
            })),
            paymentMethod: o.paymentMethod ?? "ONLINE",
            deliveryDetails: o.deliveryDetails ?? [],
            refundReason: o.refundReason ?? null,
            refundedAt: o.refundedAt ?? null,
            bankTransferRejectReason: o.bankTransferRejectReason ?? null,
            deleteBlocker: o.deleteBlocker ?? null,
          })),
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function updateFulfillment(order: OrderSummary, fulfillmentStatus: OrderSummary["fulfillmentStatus"]) {
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fulfillmentStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update.");
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, fulfillmentStatus } : o)));
      setSelected((prev) => (prev && prev.id === order.id ? { ...prev, fulfillmentStatus } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update.");
    }
  }

  const [resendingId, setResendingId] = useState<string | null>(null);

  async function handleResendDigital(order: OrderSummary, delivery: DigitalDeliverySummary) {
    setResendingId(delivery.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/orders/${order.id}/resend-digital-delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryId: delivery.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Resend failed.");
      const bump = (d: DigitalDeliverySummary) => (d.id === delivery.id ? { ...d, resendCount: d.resendCount + 1 } : d);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, digitalDeliveries: o.digitalDeliveries.map(bump) } : o)));
      setSelected((prev) => (prev && prev.id === order.id ? { ...prev, digitalDeliveries: prev.digitalDeliveries.map(bump) } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Resend failed.");
    } finally {
      setResendingId(null);
    }
  }

  async function handleRefund(order: OrderSummary) {
    setRefunding(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/orders/${order.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: refundReason, confirmOrderNumber: refundConfirmNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Refund failed.");
      patchOrder(order.id, { status: "REFUNDED", refundReason: data.order?.refundReason ?? refundReason, refundedAt: data.order?.refundedAt ?? new Date().toISOString() });
      setRefundOpen(false);
      setMoreOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Refund failed.");
    } finally {
      setRefunding(false);
    }
  }

  async function handleDelete(order: OrderSummary) {
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/orders/${order.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmOrderNumber: deleteConfirmNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't delete this order.");
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      openOrder(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't delete this order.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBankTransfer(order: OrderSummary, action: "confirm" | "reject") {
    setTransferBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/orders/${order.id}/bank-transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: action === "reject" ? rejectReason : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't update this order.");
      patchOrder(order.id, {
        status: data.order?.status ?? (action === "confirm" ? "PAID" : "CANCELLED"),
        bankTransferRejectReason: data.order?.bankTransferRejectReason ?? null,
      });
      setRejectOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't update this order.");
    } finally {
      setTransferBusy(false);
    }
  }

  const awaitingCount = orders.filter(isAwaitingTransfer).length;

  return (
    <div>
      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
          placeholder="Search order # or customer…"
          style={{ flex: 1, minWidth: 200, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, color: "#f0f2ff", padding: "0.5rem 0.8rem", fontSize: "0.82rem", outline: "none", fontFamily: "inherit" }}
        />
        <select
          value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); }}
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, color: "#f0f2ff", padding: "0.5rem 0.8rem", fontSize: "0.82rem", fontFamily: "inherit" }}
        >
          <option value="">All statuses</option>
          <option value="AWAITING_TRANSFER" style={{ background: "#0d0f1a" }}>Bank transfer to confirm</option>
          {(["PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"] as const).map((s) => (
            <option key={s} value={s} style={{ background: "#0d0f1a" }}>{s}</option>
          ))}
        </select>
        <button
          type="button" onClick={() => void runSearch()} disabled={loading}
          style={{ padding: "0.5rem 1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem" }}
        >
          {loading ? "…" : "Filter"}
        </button>
      </div>

      {awaitingCount > 0 && statusFilter !== "AWAITING_TRANSFER" && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 12, padding: "0.7rem 1rem", marginBottom: "1rem", fontSize: "0.82rem", color: "#bfdbfe" }}>
          <span style={{ flex: 1, minWidth: 200 }}>
            {awaitingCount === 1 ? "1 bank transfer is" : `${awaitingCount} bank transfers are`} waiting for you to confirm the money arrived.
          </span>
          <button
            type="button" onClick={() => { setStatusFilter("AWAITING_TRANSFER"); setOrders((prev) => prev.filter(isAwaitingTransfer)); }}
            style={{ padding: "0.35rem 0.8rem", borderRadius: 8, border: "1px solid rgba(96,165,250,0.4)", background: "transparent", color: "#bfdbfe", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Show them
          </button>
        </div>
      )}

      {orders.length === 0 ? (
        <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)", color: "rgba(240,242,255,0.45)", fontSize: "0.85rem" }}>
          {statusFilter || q ? "No orders match this filter." : "No orders yet."}
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ color: "rgba(240,242,255,0.4)", textAlign: "left", background: "rgba(255,255,255,0.02)" }}>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Order</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Customer</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Total</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Status</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Fulfillment</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Delivery info</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => openOrder(order)}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e2e4f5", cursor: "pointer" }}
                >
                  <td style={{ padding: "0.7rem 1rem", fontFamily: "ui-monospace, monospace" }}>{order.orderNumber}</td>
                  <td style={{ padding: "0.7rem 1rem" }}>{order.customerName ?? order.customerEmail}</td>
                  <td style={{ padding: "0.7rem 1rem", fontFamily: "ui-monospace, monospace" }}>{formatMoney(order.amountMinor, order.currency)}</td>
                  <td style={{ padding: "0.7rem 1rem" }}>
                    <StatusPill status={order.status} awaitingTransfer={isAwaitingTransfer(order)} />
                    {order.paymentMethod === "BANK_TRANSFER" && !isAwaitingTransfer(order) && (
                      <div style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.35)", marginTop: 3 }}>Bank transfer</div>
                    )}
                  </td>
                  <td style={{ padding: "0.7rem 1rem", color: "rgba(240,242,255,0.55)" }}>{order.fulfillmentStatus.replace(/_/g, " ").toLowerCase()}</td>
                  <td style={{ padding: "0.7rem 1rem", verticalAlign: "top" }}>
                    <DeliveryInfoCell rows={order.deliveryDetails} onShowAll={() => setDrawerOrder(order)} />
                  </td>
                  <td style={{ padding: "0.7rem 1rem", color: "rgba(240,242,255,0.4)" }}>{new Date(order.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── DETAIL MODAL ────────────────────────── */}
      {selected && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.7)", padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) openOrder(null); }}
        >
          <div style={{ width: "min(100%,480px)", maxHeight: "88vh", overflowY: "auto", background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "1.75rem" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff" }}>
                  {selected.orderNumber}
                </h2>
                <div style={{ marginTop: 4 }}><StatusPill status={selected.status} awaitingTransfer={isAwaitingTransfer(selected)} /></div>
              </div>
              <button type="button" onClick={() => openOrder(null)} style={{ background: "rgba(255,255,255,0.06)", border: "none", cursor: "pointer", color: "rgba(240,242,255,0.5)", padding: "0.4rem", borderRadius: 8 }}>
                ✕
              </button>
            </div>

            <div style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.6)", marginBottom: "1rem" }}>
              {selected.customerName ?? "—"} · {selected.customerEmail}
              {selected.paymentMethod === "BANK_TRANSFER" && <span style={{ color: "rgba(240,242,255,0.4)" }}> · paid by bank transfer</span>}
            </div>

            {isAwaitingTransfer(selected) && (
              <div style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 12, padding: "0.9rem 1rem", marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#dbeafe" }}>Waiting for you to confirm the transfer</div>
                <p style={{ fontSize: "0.78rem", color: "rgba(219,234,254,0.75)", margin: "0.3rem 0 0.8rem", lineHeight: 1.5 }}>
                  The customer says they sent {formatMoney(selected.amountMinor, selected.currency)} to your bank account. Check it has arrived before confirming —
                  confirming emails them their order confirmation and lets you fulfil it.
                </p>
                {!rejectOpen ? (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button" disabled={transferBusy} onClick={() => void handleBankTransfer(selected, "confirm")}
                      style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", fontWeight: 700, fontSize: "0.8rem", cursor: transferBusy ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                    >
                      {transferBusy ? "Confirming…" : "Confirm payment received"}
                    </button>
                    <button
                      type="button" disabled={transferBusy} onClick={() => setRejectOpen(true)}
                      style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(240,242,255,0.75)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Not received
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: "0.5rem" }}>
                    <textarea
                      value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={2} maxLength={500}
                      placeholder="Optional note to the customer, e.g. No transfer with this reference reached our account."
                      style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, color: "#f0f2ff", padding: "0.5rem 0.7rem", fontSize: "0.8rem", fontFamily: "inherit", resize: "vertical" }}
                    />
                    <span style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.45)" }}>The order will be cancelled, its stock released, and the customer emailed.</span>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        type="button" disabled={transferBusy} onClick={() => void handleBankTransfer(selected, "reject")}
                        style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#f87171", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}
                      >
                        {transferBusy ? "Cancelling…" : "Cancel order"}
                      </button>
                      <button type="button" onClick={() => setRejectOpen(false)} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "none", background: "transparent", color: "rgba(240,242,255,0.55)", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {selected.status === "CANCELLED" && selected.bankTransferRejectReason && (
              <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", marginBottom: "1rem" }}>Cancelled — transfer not received: “{selected.bankTransferRejectReason}”</div>
            )}

            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "0.8rem 1rem", marginBottom: "1rem" }}>
              {selected.items.map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "#e2e4f5", padding: "0.25rem 0" }}>
                  <span>{item.quantity}× {item.nameSnapshot}</span>
                  <span style={{ fontFamily: "ui-monospace, monospace" }}>{formatMoney(item.unitPriceMinor * item.quantity, selected.currency)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", fontWeight: 700, color: "#f0f2ff", borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "0.5rem", paddingTop: "0.5rem" }}>
                <span>Total</span>
                <span style={{ fontFamily: "ui-monospace, monospace" }}>{formatMoney(selected.amountMinor, selected.currency)}</span>
              </div>
            </div>

            {selected.deliveryDetails.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.4rem" }}>Delivery info</span>
                <DeliveryDetailsList rows={selected.deliveryDetails} />
              </div>
            )}

            {selected.booking && (
              <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.6)", marginBottom: "1rem" }}>
                Booked for {new Date(selected.booking.scheduledStart).toLocaleString()} — {selected.booking.status}
              </div>
            )}

            {selected.digitalDeliveries.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.4rem" }}>
                  Digital delivery
                </span>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  {selected.digitalDeliveries.map((d) => (
                    <div
                      key={d.id}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
                        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.6rem 0.8rem",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.82rem", color: "#e2e4f5", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {d.productName}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.45)", marginTop: 2 }}>
                          {d.deliveredAt ? `Delivered ${new Date(d.deliveredAt).toLocaleString()}` : "Not yet delivered"}
                          {d.method === "FILE_DOWNLOAD" && ` · ${d.downloadCount}${d.maxDownloads !== null ? `/${d.maxDownloads}` : ""} downloads`}
                          {d.resendCount > 0 && ` · resent ${d.resendCount}×`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleResendDigital(selected, d)}
                        disabled={resendingId === d.id}
                        style={{
                          flexShrink: 0, padding: "0.4rem 0.7rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)",
                          background: "rgba(255,255,255,0.05)", color: "#f0f2ff", cursor: resendingId === d.id ? "not-allowed" : "pointer",
                          fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 600,
                        }}
                      >
                        {resendingId === d.id ? "Sending…" : "Resend"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <FieldLabel label="Fulfillment status">
              <select
                value={selected.fulfillmentStatus}
                onChange={(e) => void updateFulfillment(selected, e.target.value as OrderSummary["fulfillmentStatus"])}
                style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, color: "#f0f2ff", padding: "0.55rem 0.8rem", fontSize: "0.85rem", fontFamily: "inherit" }}
              >
                {FULFILLMENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} style={{ background: "#0d0f1a" }}>{opt.replace(/_/g, " ")}</option>
                ))}
              </select>
            </FieldLabel>

            {actionError && <p style={{ fontSize: "0.8rem", color: "#f87171", marginTop: "0.75rem" }}>{actionError}</p>}

            {selected.status === "REFUNDED" && selected.refundReason && (
              <div style={{ fontSize: "0.76rem", color: "rgba(240,242,255,0.5)", marginTop: "1rem", lineHeight: 1.5 }}>
                Refunded{selected.refundedAt ? ` on ${new Date(selected.refundedAt).toLocaleDateString()}` : ""} — reason: “{selected.refundReason}”
              </div>
            )}

            {/* Destructive actions live behind a deliberate extra click — a refund used to be a
                big red button right under the fulfilment dropdown, one mis-tap away. */}
            <div style={{ marginTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.75rem" }}>
              <button
                type="button" aria-expanded={moreOpen} onClick={() => { setMoreOpen((v) => !v); setRefundOpen(false); setDeleteOpen(false); setActionError(null); }}
                style={{ background: "none", border: "none", padding: 0, color: "rgba(240,242,255,0.45)", fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                More actions {moreOpen ? "▴" : "▾"}
              </button>

              {moreOpen && !refundOpen && !deleteOpen && (
                <div style={{ marginTop: "0.6rem", display: "grid", gap: "0.5rem" }}>
                  {selected.status === "PAID" && (
                    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 0.9rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                      <div>
                        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f0f2ff" }}>Refund this order</div>
                        <div style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.45)", marginTop: 2 }}>Returns {formatMoney(selected.amountMinor, selected.currency)} to the customer. Can&apos;t be undone.</div>
                      </div>
                      <button
                        type="button" onClick={() => setRefundOpen(true)}
                        style={{ flexShrink: 0, padding: "0.4rem 0.75rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.76rem", fontWeight: 600 }}
                      >
                        Start refund…
                      </button>
                    </div>
                  )}
                  <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 0.9rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                    <div>
                      <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f0f2ff" }}>Delete this order</div>
                      <div style={{ fontSize: "0.72rem", color: selected.deleteBlocker ? "rgba(251,191,36,0.85)" : "rgba(240,242,255,0.45)", marginTop: 2, lineHeight: 1.45 }}>
                        {selected.deleteBlocker ?? "Removes it from your store for good — handy for test orders. Can't be recovered."}
                      </div>
                    </div>
                    {!selected.deleteBlocker && (
                      <button
                        type="button" onClick={() => setDeleteOpen(true)}
                        style={{ flexShrink: 0, padding: "0.4rem 0.75rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.76rem", fontWeight: 600 }}
                      >
                        Delete…
                      </button>
                    )}
                  </div>
                </div>
              )}

              {refundOpen && (
                <RefundPanel
                  order={selected}
                  reason={refundReason}
                  onReasonChange={setRefundReason}
                  confirmNumber={refundConfirmNumber}
                  onConfirmNumberChange={setRefundConfirmNumber}
                  acknowledged={refundAcknowledged}
                  onAcknowledgedChange={setRefundAcknowledged}
                  busy={refunding}
                  onCancel={() => { setRefundOpen(false); setActionError(null); }}
                  onSubmit={() => void handleRefund(selected)}
                />
              )}

              {deleteOpen && (
                <DeletePanel
                  order={selected}
                  confirmNumber={deleteConfirmNumber}
                  onConfirmNumberChange={setDeleteConfirmNumber}
                  acknowledged={deleteAcknowledged}
                  onAcknowledgedChange={setDeleteAcknowledged}
                  busy={deleting}
                  onCancel={() => { setDeleteOpen(false); setDeleteConfirmNumber(""); setDeleteAcknowledged(false); setActionError(null); }}
                  onSubmit={() => void handleDelete(selected)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {drawerOrder && <DeliveryInfoDrawer order={drawerOrder} onClose={() => setDrawerOrder(null)} />}
    </div>
  );
}

/**
 * Permanent delete: says plainly what disappears (and what happens to stock, bookings and
 * download links), that it can't be recovered, then needs the order number typed back plus a
 * tick — the server re-checks the number, so this can't be skipped by a direct API call.
 */
function DeletePanel({
  order, confirmNumber, onConfirmNumberChange, acknowledged, onAcknowledgedChange, busy, onCancel, onSubmit,
}: {
  order: OrderSummary;
  confirmNumber: string;
  onConfirmNumberChange: (v: string) => void;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const amount = formatMoney(order.amountMinor, order.currency);
  const numberMatches = confirmNumber.trim().toUpperCase() === order.orderNumber.toUpperCase();
  const ready = numberMatches && acknowledged && !busy;
  const consequences: string[] = [];
  if (order.status === "PAID") consequences.push(`It's marked paid, so your sales totals will no longer include ${amount}.`);
  if (order.status === "PENDING") consequences.push("It's still waiting for payment — the stock it's holding goes back on the shelf. If the customer already paid you, refund them yourself first.");
  if (order.digitalDeliveries.length > 0) consequences.push("Any download or access links already sent to the customer will stop working.");
  if (order.booking) consequences.push("Its booked time slot becomes available again.");
  consequences.push("The customer isn't notified.");
  const field: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, color: "#f0f2ff", padding: "0.5rem 0.7rem", fontSize: "0.82rem", fontFamily: "inherit" };
  return (
    <div style={{ marginTop: "0.6rem", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", borderRadius: 12, padding: "1rem", display: "grid", gap: "0.75rem" }}>
      <div>
        <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#fecaca" }}>Delete order {order.orderNumber} forever?</div>
        <p style={{ fontSize: "0.78rem", color: "#fecaca", margin: "0.35rem 0 0", lineHeight: 1.5, fontWeight: 600 }}>
          This can&apos;t be recovered. The order, its items and {order.customerName ?? "the customer"}&apos;s details are removed from your store for good.
        </p>
        <ul style={{ fontSize: "0.76rem", color: "rgba(254,202,202,0.75)", margin: "0.4rem 0 0", paddingLeft: "1.1rem", listStyle: "disc", lineHeight: 1.55 }}>
          {consequences.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
      <label style={{ display: "block" }}>
        <span style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.3rem" }}>
          Type <span style={{ fontFamily: "ui-monospace, monospace", color: "#f0f2ff" }}>{order.orderNumber}</span> to confirm
        </span>
        <input type="text" value={confirmNumber} onChange={(e) => onConfirmNumberChange(e.target.value)} autoComplete="off" spellCheck={false} style={{ ...field, fontFamily: "ui-monospace, monospace" }} />
      </label>
      <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.76rem", color: "rgba(240,242,255,0.7)", cursor: "pointer" }}>
        <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledgedChange(e.target.checked)} style={{ marginTop: 2 }} />
        I understand this order will be deleted permanently and can&apos;t be brought back.
      </label>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "none", background: "transparent", color: "rgba(240,242,255,0.6)", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
          Keep order
        </button>
        <button
          type="button" disabled={!ready} onClick={onSubmit}
          style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.4)", background: ready ? "rgba(239,68,68,0.2)" : "rgba(239,68,68,0.06)", color: "#f87171", fontWeight: 700, fontSize: "0.8rem", cursor: ready ? "pointer" : "not-allowed", opacity: ready ? 1 : 0.55, fontFamily: "inherit" }}
        >
          {busy ? "Deleting…" : "Delete forever"}
        </button>
      </div>
    </div>
  );
}

/**
 * The refund "due process": what will happen (and that it's final), a required reason kept
 * on the order, the order number typed back, and an explicit acknowledgement — the server
 * re-checks the reason and order number, so this can't be bypassed by a direct API call.
 */
function RefundPanel({
  order, reason, onReasonChange, confirmNumber, onConfirmNumberChange, acknowledged, onAcknowledgedChange, busy, onCancel, onSubmit,
}: {
  order: OrderSummary;
  reason: string;
  onReasonChange: (v: string) => void;
  confirmNumber: string;
  onConfirmNumberChange: (v: string) => void;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const amount = formatMoney(order.amountMinor, order.currency);
  const isBankTransfer = order.paymentMethod === "BANK_TRANSFER";
  const numberMatches = confirmNumber.trim().toUpperCase() === order.orderNumber.toUpperCase();
  const ready = reason.trim().length >= 5 && numberMatches && acknowledged && !busy;
  const field: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, color: "#f0f2ff", padding: "0.5rem 0.7rem", fontSize: "0.82rem", fontFamily: "inherit" };
  return (
    <div style={{ marginTop: "0.6rem", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", borderRadius: 12, padding: "1rem", display: "grid", gap: "0.75rem" }}>
      <div>
        <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#fecaca" }}>Refund {amount}</div>
        <p style={{ fontSize: "0.76rem", color: "rgba(254,202,202,0.75)", margin: "0.3rem 0 0", lineHeight: 1.5 }}>
          {isBankTransfer
            ? `This order was paid by bank transfer, so Plexo can't send the money back for you. Transfer ${amount} back to the customer yourself first — this marks the order refunded and emails them.`
            : `${amount} goes back to the customer's original payment method via Paystack, and they're emailed. This can't be undone.`}
          {" "}Stock and booking slots are not released automatically.
        </p>
      </div>
      <label style={{ display: "block" }}>
        <span style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.3rem" }}>Reason for the refund</span>
        <textarea value={reason} onChange={(e) => onReasonChange(e.target.value)} rows={2} maxLength={500} placeholder="e.g. Item arrived damaged" style={{ ...field, resize: "vertical" }} />
      </label>
      <label style={{ display: "block" }}>
        <span style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.3rem" }}>
          Type <span style={{ fontFamily: "ui-monospace, monospace", color: "#f0f2ff" }}>{order.orderNumber}</span> to confirm
        </span>
        <input type="text" value={confirmNumber} onChange={(e) => onConfirmNumberChange(e.target.value)} autoComplete="off" spellCheck={false} style={{ ...field, fontFamily: "ui-monospace, monospace" }} />
      </label>
      <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.76rem", color: "rgba(240,242,255,0.7)", cursor: "pointer" }}>
        <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledgedChange(e.target.checked)} style={{ marginTop: 2 }} />
        {isBankTransfer ? `I've already sent ${amount} back to the customer.` : "I understand this refund is final."}
      </label>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "none", background: "transparent", color: "rgba(240,242,255,0.6)", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
          Cancel
        </button>
        <button
          type="button" disabled={!ready} onClick={onSubmit}
          style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.4)", background: ready ? "rgba(239,68,68,0.2)" : "rgba(239,68,68,0.06)", color: "#f87171", fontWeight: 700, fontSize: "0.8rem", cursor: ready ? "pointer" : "not-allowed", opacity: ready ? 1 : 0.55, fontFamily: "inherit" }}
        >
          {busy ? "Refunding…" : isBankTransfer ? "Mark as refunded" : `Refund ${amount}`}
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginTop: "0.75rem" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>{label}</span>
      {children}
    </label>
  );
}
