"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PaystackCustomer = {
  id: number;
  customerCode: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  createdAt: string;
};

export function CustomersClient({ templateId, paystackConfigured }: { templateId: string; paystackConfigured: boolean }) {
  const [customers, setCustomers] = useState<PaystackCustomer[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(paystackConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paystackConfigured) return;
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
  }, [templateId, page, paystackConfigured]);

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: 0 }}>Customers</h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginTop: 4 }}>
          Pulled straight from Paystack — everyone who's ever paid you.
        </p>
      </div>

      {!paystackConfigured ? (
        <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)" }}>
          <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.45)", marginBottom: "1rem" }}>
            Connect Paystack in Settings to see your customers here.
          </p>
          <Link
            href={`/dashboard/commerce/${templateId}/settings`}
            style={{ display: "inline-flex", padding: "0.55rem 1.1rem", borderRadius: 10, fontSize: "0.82rem", fontWeight: 700, background: "rgba(139,92,246,0.15)", color: "var(--brand)", textDecoration: "none" }}
          >
            Go to Settings
          </Link>
        </div>
      ) : error ? (
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
                  <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Customer since</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e2e4f5" }}>
                    <td style={{ padding: "0.7rem 1rem" }}>{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td style={{ padding: "0.7rem 1rem" }}>{c.email}</td>
                    <td style={{ padding: "0.7rem 1rem", color: "rgba(240,242,255,0.55)" }}>{c.phone ?? "—"}</td>
                    <td style={{ padding: "0.7rem 1rem", color: "rgba(240,242,255,0.4)" }}>{new Date(c.createdAt).toLocaleDateString()}</td>
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
