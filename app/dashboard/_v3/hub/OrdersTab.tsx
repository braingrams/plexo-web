"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useCallback, useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Modal, OptimisticLoader, Skeleton, type BadgeTone } from "../ui";
import { OrderMore, type OrderExtras } from "./OrderTools";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";

type Order = {
  id: string;
  orderNumber: number | string;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED";
  fulfillmentStatus: "UNFULFILLED" | "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "COMPLETED";
  amountMinor: number;
  currency?: string;
  customerEmail: string;
  customerName?: string | null;
  createdAt: string;
  paymentMethod?: string;
  items: { nameSnapshot: string; quantity: number; unitPriceMinor: number }[];
} & Omit<OrderExtras, "orderNumber" | "status" | "paymentMethod" | "amountMinor" | "currency" | "customerName">;

const FILTERS = [
  { id: "", label: "All" },
  { id: "PAID", label: "Paid" },
  { id: "AWAITING", label: "Waiting for payment" },
  { id: "REFUNDED", label: "Refunded" },
];

/** What an order is, in the words a shop owner uses. */
export function orderLabel(o: Pick<Order, "status" | "fulfillmentStatus" | "paymentMethod">): { text: string; tone: BadgeTone } {
  if (o.status === "PENDING" && o.paymentMethod === "BANK_TRANSFER") return { text: "Check your bank", tone: "info" };
  if (o.status === "PENDING") return { text: "Waiting for payment", tone: "warning" };
  if (o.status === "FAILED") return { text: "Payment failed", tone: "danger" };
  if (o.status === "CANCELLED") return { text: "Cancelled", tone: "neutral" };
  if (o.status === "REFUNDED") return { text: "Refunded", tone: "neutral" };
  if (o.fulfillmentStatus === "COMPLETED") return { text: "Done", tone: "success" };
  if (o.fulfillmentStatus === "SHIPPED") return { text: "On its way", tone: "info" };
  if (o.fulfillmentStatus === "READY_FOR_PICKUP") return { text: "Ready to collect", tone: "info" };
  if (o.fulfillmentStatus === "PROCESSING") return { text: "Getting it ready", tone: "info" };
  return { text: "New: paid", tone: "success" };
}

const NEXT: { to: Order["fulfillmentStatus"]; label: string }[] = [
  { to: "PROCESSING", label: "I'm getting it ready" },
  { to: "SHIPPED", label: "It's on its way" },
  { to: "READY_FOR_PICKUP", label: "Ready to collect" },
  { to: "COMPLETED", label: "Mark as done" },
];

export function OrdersTab({ siteId, currency, hideHeader }: { siteId: string; currency: string; hideHeader?: boolean }) {
  const [filter, setFilter] = useState("");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const pageSize = 20;

  const load = useCallback(async () => {
    setError(null);
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filter === "AWAITING") {
      p.set("status", "PENDING");
    } else if (filter) p.set("status", filter);
    if (q.trim()) p.set("q", q.trim());
    try {
      const r = await hubApi<{ orders: Order[]; total: number }>(`/api/v1/commerce/${siteId}/orders?${p}`);
      setOrders(r.orders);
      setTotal(r.total);
    } catch (e) {
      setError(errMsg(e, "We couldn't load your orders."));
    }
  }, [siteId, filter, page, q]);

  useEffect(() => {
    void load();
  }, [load]);

  // Search as they type, after a short pause.
  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setQ(search);
    }, 350);
    return () => clearTimeout(id);
  }, [search]);

  async function patch(o: Order, fulfillmentStatus: Order["fulfillmentStatus"]) {
    setBusy(true);
    try {
      await hubApi(`/api/v1/commerce/${siteId}/orders/${o.id}`, { method: "PATCH", json: { fulfillmentStatus } });
      const next = { ...o, fulfillmentStatus };
      setOrders((list) => list?.map((x) => (x.id === o.id ? next : x)) ?? null);
      setOpen(next);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function transfer(o: Order, action: "confirm" | "reject") {
    setBusy(true);
    try {
      await hubApi(`/api/v1/commerce/${siteId}/orders/${o.id}/bank-transfer`, { method: "POST", json: { action, reason: action === "reject" ? "We didn't receive this payment." : undefined } });
      setOpen(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const label = open ? orderLabel(open) : null;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      {!hideHeader ? <TabBar title="Your orders" sub="Everything people have bought. Tap an order to see what to do next." /> : null}
      <div className="plx-toolbar" data-tour="hub-orders-tools">
        <Input label="Search orders" hideLabel type="search" fieldClassName="plx-hsearch" placeholder="Search by name, email or order number" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="plx-filters" role="radiogroup" aria-label="Show orders">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="plx-hchip" role="radio" aria-checked={filter === f.id} onClick={() => { setPage(1); setFilter(f.id); }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {orders && orders.length ? <p className="plx-count" aria-live="polite">{total} order{total === 1 ? "" : "s"}{q || filter ? (total === 1 ? " matches" : " match") : ""}</p> : null}
      {error ? <GateOrError error={error}><div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div></GateOrError> : null}
      {orders === null && !error ? (
        <Card padding="lg" style={{ minHeight: 200, display: "grid", placeItems: "center" }}>
          <OptimisticLoader steps={["Loading your orders…", "Checking payment confirmations…"]} subtitle="Fetching your order history" />
        </Card>
      ) : orders && orders.length === 0 ? (
        q || filter ? <EmptyState title="No orders match" body="Try a different word, or show all your orders." illustration={<Inbox size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />} /> : <EmptyState title="No orders yet" body="When someone buys from your shop, the order shows up here and we email you. Share your site to get your first one." illustration={<Inbox size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />} />
      ) : orders ? (
        <Card padding="none" className="plx-listcard" data-tour="hub-orders">
          <ul className="plx-list">
            {orders.map((o) => {
              const l = orderLabel(o);
              return (
                <li key={o.id} style={{ display: "contents" }}>
                  <button type="button" className="plx-hrow" onClick={() => setOpen(o)}>
                    <span className="plx-hrow__main">
                      <span className="plx-hrow__title">{o.customerName || o.customerEmail}</span>
                      <span className="plx-hrow__sub">
                        Order #{o.orderNumber} · {new Date(o.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" })} · {o.items.map((i) => i.nameSnapshot).join(", ")}
                      </span>
                    </span>
                    <span className="plx-hrow__end">
                      <Badge tone={l.tone}>{l.text}</Badge>
                      <span className="plx-hrow__price">{formatMoney(o.amountMinor, o.currency ?? currency)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {pages > 1 ? (
        <div className="plx-hub__bar">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <span className="plx-small">
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      ) : null}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Order #${open.orderNumber}` : ""} description={open ? `${open.customerName ? open.customerName + " · " : ""}${open.customerEmail}` : undefined} footer={<Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>}>
        {open && label ? (
          <div className="plx-form">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <Badge tone={label.tone}>{label.text}</Badge>
              <b style={{ fontSize: 20 }}>{formatMoney(open.amountMinor, open.currency ?? currency)}</b>
            </div>
            <ul className="plx-list" style={{ border: "1px solid var(--plx-border)", borderRadius: 14 }}>
              {open.items.map((i, n) => (
                <li key={n} className="plx-hrow" style={{ minHeight: 56, padding: "10px 16px" }}>
                  <span className="plx-hrow__main"><span className="plx-hrow__title">{i.nameSnapshot}</span></span>
                  <span className="plx-small">{i.quantity} × {formatMoney(i.unitPriceMinor, open.currency ?? currency)}</span>
                </li>
              ))}
            </ul>
            {open.status === "PENDING" && open.paymentMethod === "BANK_TRANSFER" ? (
              <div className="plx-inlinemsg">
                <div>
                  They said they paid by bank transfer. Check your bank. If the money is there, confirm it so the order goes through.
                  <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                    <Button loading={busy} onClick={() => transfer(open, "confirm")}>The money arrived</Button>
                    <Button variant="secondary" disabled={busy} onClick={() => transfer(open, "reject")}>I didn&apos;t get it</Button>
                  </div>
                </div>
              </div>
            ) : open.status === "PAID" ? (
              <div>
                <p className="plx-h3" style={{ marginBottom: 10 }}>What&apos;s happening with it?</p>
                <div className="plx-filters">
                  {NEXT.map((n) => (
                    <Button key={n.to} size="sm" variant={open.fulfillmentStatus === n.to ? "primary" : "secondary"} disabled={busy} onClick={() => patch(open, n.to)}>
                      {n.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <OrderMore
              siteId={siteId}
              order={open}
              currency={currency}
              onChange={(patch) => {
                const next = { ...open, ...patch };
                setOrders((list) => list?.map((x) => (x.id === open.id ? next : x)) ?? null);
                setOpen(next);
              }}
              onDeleted={() => {
                setOpen(null);
                void load();
              }}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
}
