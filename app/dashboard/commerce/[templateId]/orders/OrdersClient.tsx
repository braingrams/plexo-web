"use client";

import { useState } from "react";

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED";
  fulfillmentStatus: "UNFULFILLED" | "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "COMPLETED";
  amountMinor: number;
  customerEmail: string;
  customerName: string | null;
  createdAt: string;
  items: { nameSnapshot: string; quantity: number; unitPriceMinor: number }[];
  booking: { scheduledStart: string; status: string } | null;
};

function formatNaira(minor: number): string {
  return `₦${(minor / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_COLORS: Record<OrderSummary["status"], string> = {
  PENDING: "#fbbf24",
  PAID: "#34d399",
  FAILED: "#f87171",
  REFUNDED: "#a78bfa",
  CANCELLED: "rgba(240,242,255,0.4)",
};

const FULFILLMENT_OPTIONS: OrderSummary["fulfillmentStatus"][] = ["UNFULFILLED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"];

function StatusPill({ status }: { status: OrderSummary["status"] }) {
  const color = STATUS_COLORS[status];
  return (
    <span style={{ fontSize: "0.7rem", fontWeight: 700, color, background: `${color}22`, padding: "2px 8px", borderRadius: 6 }}>
      {status}
    </span>
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

  async function runSearch() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
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
            customerEmail: o.customerEmail,
            customerName: o.customerName,
            createdAt: o.createdAt,
            items: o.items,
            booking: o.booking,
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

  async function handleRefund(order: OrderSummary) {
    setRefunding(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/orders/${order.id}/refund`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Refund failed.");
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: "REFUNDED" } : o)));
      setSelected((prev) => (prev && prev.id === order.id ? { ...prev, status: "REFUNDED" } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Refund failed.");
    } finally {
      setRefunding(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: 0 }}>Orders</h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginTop: 4 }}>Every order for this site.</p>
      </div>

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

      {orders.length === 0 ? (
        <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)", color: "rgba(240,242,255,0.45)", fontSize: "0.85rem" }}>
          No orders yet.
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
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => setSelected(order)}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e2e4f5", cursor: "pointer" }}
                >
                  <td style={{ padding: "0.7rem 1rem", fontFamily: "ui-monospace, monospace" }}>{order.orderNumber}</td>
                  <td style={{ padding: "0.7rem 1rem" }}>{order.customerName ?? order.customerEmail}</td>
                  <td style={{ padding: "0.7rem 1rem", fontFamily: "ui-monospace, monospace" }}>{formatNaira(order.amountMinor)}</td>
                  <td style={{ padding: "0.7rem 1rem" }}><StatusPill status={order.status} /></td>
                  <td style={{ padding: "0.7rem 1rem", color: "rgba(240,242,255,0.55)" }}>{order.fulfillmentStatus.replace(/_/g, " ").toLowerCase()}</td>
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
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
        >
          <div style={{ width: "min(100%,480px)", maxHeight: "88vh", overflowY: "auto", background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "1.75rem" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff" }}>
                  {selected.orderNumber}
                </h2>
                <div style={{ marginTop: 4 }}><StatusPill status={selected.status} /></div>
              </div>
              <button type="button" onClick={() => setSelected(null)} style={{ background: "rgba(255,255,255,0.06)", border: "none", cursor: "pointer", color: "rgba(240,242,255,0.5)", padding: "0.4rem", borderRadius: 8 }}>
                ✕
              </button>
            </div>

            <div style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.6)", marginBottom: "1rem" }}>
              {selected.customerName ?? "—"} · {selected.customerEmail}
            </div>

            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "0.8rem 1rem", marginBottom: "1rem" }}>
              {selected.items.map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "#e2e4f5", padding: "0.25rem 0" }}>
                  <span>{item.quantity}× {item.nameSnapshot}</span>
                  <span style={{ fontFamily: "ui-monospace, monospace" }}>{formatNaira(item.unitPriceMinor * item.quantity)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", fontWeight: 700, color: "#f0f2ff", borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "0.5rem", paddingTop: "0.5rem" }}>
                <span>Total</span>
                <span style={{ fontFamily: "ui-monospace, monospace" }}>{formatNaira(selected.amountMinor)}</span>
              </div>
            </div>

            {selected.booking && (
              <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.6)", marginBottom: "1rem" }}>
                Booked for {new Date(selected.booking.scheduledStart).toLocaleString()} — {selected.booking.status}
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

            {selected.status === "PAID" && (
              <button
                type="button"
                onClick={() => void handleRefund(selected)}
                disabled={refunding}
                style={{
                  marginTop: "1.25rem", width: "100%", padding: "0.65rem", borderRadius: 9, border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.1)", color: "#f87171", cursor: refunding ? "not-allowed" : "pointer",
                  fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 700,
                }}
              >
                {refunding ? "Refunding…" : "Refund via Paystack"}
              </button>
            )}
          </div>
        </div>
      )}
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
