"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { Pagination } from "../../../_components/Pagination";

type CommerceCustomer = {
  email: string;
  name: string | null;
  phone: string | null;
  customerSince: string;
  lastOrderAt: string;
  orderCount: number;
  totalSpentMinor: number;
  currency: string;
};

export function CustomersClient({ templateId }: { templateId: string }) {
  const [customers, setCustomers] = useState<CommerceCustomer[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/v1/commerce/${templateId}/customers?page=${page}&pageSize=${pageSize}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load customers.");
        setCustomers(data.customers);
        if (data.page !== page) setPage(data.page);
        setTotal(data.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load customers."))
      .finally(() => setLoading(false));
  }, [templateId, page, pageSize]);

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--cmx-muted, rgba(240,242,255,0.5))", marginBottom: "1.25rem" }}>
        Everyone who's completed a paid order with you, however they paid.
      </p>

      {error ? (
        <div style={{ padding: "2rem", textAlign: "center", borderRadius: 14, border: "1px solid color-mix(in srgb, var(--cmx-danger, rgb(239,68,68)) 25%, transparent)", background: "color-mix(in srgb, var(--cmx-danger, rgb(239,68,68)) 6%, transparent)", color: "var(--cmx-danger, #f87171)", fontSize: "0.85rem" }}>
          {error}
        </div>
      ) : loading ? (
        <p style={{ color: "var(--cmx-muted, rgba(240,242,255,0.4))", fontSize: "0.85rem" }}>Loading…</p>
      ) : customers.length === 0 ? (
        <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 12%, transparent)", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)", color: "var(--cmx-muted, rgba(240,242,255,0.45))", fontSize: "0.85rem" }}>
          No customers yet — they'll show up here once someone pays.
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 8%, transparent)", borderRadius: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ color: "var(--cmx-muted, rgba(240,242,255,0.4))", textAlign: "left", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)" }}>
                  <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Name</th>
                  <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Email</th>
                  <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Phone</th>
                  <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Orders</th>
                  <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Total spent</th>
                  <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Customer since</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.email} style={{ borderTop: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent)", color: "var(--cmx-text, #e2e4f5)" }}>
                    <td style={{ padding: "0.7rem 1rem" }}>{c.name ?? "—"}</td>
                    <td style={{ padding: "0.7rem 1rem" }}>{c.email}</td>
                    <td style={{ padding: "0.7rem 1rem", color: "var(--cmx-muted, rgba(240,242,255,0.55))" }}>{c.phone ?? "—"}</td>
                    <td style={{ padding: "0.7rem 1rem" }}>{c.orderCount}</td>
                    <td style={{ padding: "0.7rem 1rem" }}>{formatMoney(c.totalSpentMinor, c.currency)}</td>
                    <td style={{ padding: "0.7rem 1rem", color: "var(--cmx-muted, rgba(240,242,255,0.4))" }}>{new Date(c.customerSince).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} pageSize={pageSize} total={total} noun="customers" disabled={loading} onChange={(n) => { setPage(n.page); setPageSize(n.pageSize); }} />
        </>
      )}
    </div>
  );
}
