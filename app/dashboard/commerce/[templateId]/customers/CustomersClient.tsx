"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/commerce/formatMoney";

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
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/v1/commerce/${templateId}/customers?page=${page}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load customers.");
        setCustomers(data.customers);
        setPageCount(data.pageCount);
        setTotal(data.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load customers."))
      .finally(() => setLoading(false));
  }, [templateId, page]);

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginBottom: "1.25rem" }}>
        Everyone who's completed a paid order with you, however they paid.
      </p>

      {error ? (
        <div style={{ padding: "2rem", textAlign: "center", borderRadius: 14, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.06)", color: "#f87171", fontSize: "0.85rem" }}>
          {error}
        </div>
      ) : loading ? (
        <p style={{ color: "rgba(240,242,255,0.4)", fontSize: "0.85rem" }}>Loading…</p>
      ) : customers.length === 0 ? (
        <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)", color: "rgba(240,242,255,0.45)", fontSize: "0.85rem" }}>
          No customers yet — they'll show up here once someone pays.
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ color: "rgba(240,242,255,0.4)", textAlign: "left", background: "rgba(255,255,255,0.02)" }}>
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
                  <tr key={c.email} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e2e4f5" }}>
                    <td style={{ padding: "0.7rem 1rem" }}>{c.name ?? "—"}</td>
                    <td style={{ padding: "0.7rem 1rem" }}>{c.email}</td>
                    <td style={{ padding: "0.7rem 1rem", color: "rgba(240,242,255,0.55)" }}>{c.phone ?? "—"}</td>
                    <td style={{ padding: "0.7rem 1rem" }}>{c.orderCount}</td>
                    <td style={{ padding: "0.7rem 1rem" }}>{formatMoney(c.totalSpentMinor, c.currency)}</td>
                    <td style={{ padding: "0.7rem 1rem", color: "rgba(240,242,255,0.4)" }}>{new Date(c.customerSince).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", marginTop: "1.25rem" }}>
              <button
                type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                style={{ padding: "0.4rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#f0f2ff", cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.4 : 1, fontFamily: "inherit", fontSize: "0.8rem" }}
              >
                Previous
              </button>
              <span style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)" }}>Page {page} of {pageCount} · {total} total</span>
              <button
                type="button" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}
                style={{ padding: "0.4rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#f0f2ff", cursor: page >= pageCount ? "not-allowed" : "pointer", opacity: page >= pageCount ? 0.4 : 1, fontFamily: "inherit", fontSize: "0.8rem" }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
