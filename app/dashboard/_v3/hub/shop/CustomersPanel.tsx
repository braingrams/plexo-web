"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Button, Card, EmptyState, OptimisticLoader, Skeleton } from "../../ui";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { customerLine } from "@/lib/commerce/shopSettingsForm";

type Customer = { email: string; name: string | null; phone: string | null; customerSince: string; lastOrderAt: string; orderCount: number; totalSpentMinor: number; currency: string };
const PAGE = 25;

/** Customers in the hub: everyone who has paid you, how many orders and how much. Same list call as the old page. */
export function CustomersPanel({ templateId }: { templateId: string }) {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    fetch(`/api/v1/commerce/${templateId}/customers?page=${page}&pageSize=${PAGE}`)
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!live) return;
        if (!ok) throw new Error(d.error ?? "We couldn't load your customers.");
        setRows(d.customers);
        setTotal(d.total ?? d.customers.length);
        if (d.page && d.page !== page) setPage(d.page);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "We couldn't load your customers."));
    return () => { live = false; };
  }, [templateId, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (error) return <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div>;
  if (rows === null)
    return (
      <Card padding="lg" style={{ minHeight: 200, display: "grid", placeItems: "center" }}>
        <OptimisticLoader steps={["Loading customer list…", "Calculating purchase totals…"]} subtitle="Fetching your customer directory" />
      </Card>
    );
  if (rows.length === 0) return <EmptyState title="No customers yet" body="When someone pays you, they show up here with how much they've spent. Share your shop to get your first one." illustration={<Users size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />} />;
  return (
    <>
      <p className="plx-count">{total} {total === 1 ? "customer" : "customers"}</p>
      <Card padding="none" className="plx-listcard" data-tour="hub-customers">
        <ul className="plx-list">
          {rows.map((c) => (
            <li key={c.email} className="plx-hrow">
              <span className="plx-hrow__main">
                <span className="plx-hrow__title">{c.name || c.email}</span>
                <span className="plx-hrow__sub">{[c.name ? c.email : null, c.phone].filter(Boolean).join(" · ") || "No phone number"}</span>
              </span>
              <span className="plx-hrow__end">
                <span className="plx-small">{customerLine(c.orderCount, c.customerSince)}</span>
                <span className="plx-hrow__price">{formatMoney(c.totalSpentMinor, c.currency)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {pages > 1 ? (
        <div className="plx-hub__bar">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="plx-small">Page {page} of {pages}</span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      ) : null}
    </>
  );
}
