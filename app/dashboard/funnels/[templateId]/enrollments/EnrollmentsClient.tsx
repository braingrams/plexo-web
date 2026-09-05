"use client";

import { useState } from "react";

type Enrollment = {
  email: string;
  name: string | null;
  status: "ACTIVE" | "REVOKED";
  paymentStatus: "FREE" | "PAID" | "REFUNDED";
  completedPageCount: number;
  enrolledAt: string;
};

async function api(input: string, init?: RequestInit) {
  const res = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

/** "Reach out" is a mailto link, not in-app messaging — the requirement is "can reach
 * out," not "needs an inbox" (see the Funnel/LMS plan's admin-UX section). Revoke/
 * reactivate is the one real mutation here. */
export function EnrollmentsClient({
  templateId, pageCount, initialEnrollments,
}: { templateId: string; pageCount: number; initialEnrollments: Enrollment[] }) {
  const [enrollments, setEnrollments] = useState(initialEnrollments);
  const [resendState, setResendState] = useState<Record<string, "sending" | "sent" | "error">>({});

  async function toggleStatus(email: string, status: "ACTIVE" | "REVOKED") {
    setEnrollments((prev) => prev.map((e) => (e.email === email ? { ...e, status } : e)));
    await api(`/api/v1/lms/funnels/${templateId}/enrollments/${encodeURIComponent(email)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch(() => {});
  }

  async function resendLink(email: string) {
    setResendState((prev) => ({ ...prev, [email]: "sending" }));
    try {
      await api(`/api/v1/lms/funnels/${templateId}/enrollments/${encodeURIComponent(email)}/resend-magic-link`, { method: "POST" });
      setResendState((prev) => ({ ...prev, [email]: "sent" }));
    } catch {
      setResendState((prev) => ({ ...prev, [email]: "error" }));
    }
  }

  if (enrollments.length === 0) {
    return (
      <div style={{
        textAlign: "center", padding: "3rem 1rem", borderRadius: 14,
        border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)", color: "rgba(240,242,255,0.45)",
      }}>
        <p style={{ fontSize: "0.85rem", margin: 0 }}>No one has signed up yet.</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
        <thead>
          <tr style={{ color: "rgba(240,242,255,0.4)", textAlign: "left" }}>
            <th style={{ fontWeight: 500, paddingBottom: 8 }}>Name</th>
            <th style={{ fontWeight: 500, paddingBottom: 8 }}>Email</th>
            <th style={{ fontWeight: 500, paddingBottom: 8 }}>Progress</th>
            <th style={{ fontWeight: 500, paddingBottom: 8 }}>Payment</th>
            <th style={{ fontWeight: 500, paddingBottom: 8 }}>Signed up</th>
            <th style={{ fontWeight: 500, paddingBottom: 8 }}></th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((e) => (
            <tr key={e.email} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e2e4f5", opacity: e.status === "REVOKED" ? 0.5 : 1 }}>
              <td style={{ padding: "10px 0" }}>{e.name || "—"}</td>
              <td style={{ padding: "10px 0" }}>{e.email}</td>
              <td style={{ padding: "10px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ color: "rgba(240,242,255,0.55)" }}>{e.completedPageCount} / {pageCount}</span>
                  <div style={{ width: 60, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div style={{ width: `${pageCount ? Math.min(100, (e.completedPageCount / pageCount) * 100) : 0}%`, height: "100%", background: "#34d399" }} />
                  </div>
                </div>
              </td>
              <td style={{ padding: "10px 0", color: "rgba(240,242,255,0.55)" }}>{e.paymentStatus === "FREE" ? "Free" : e.paymentStatus === "PAID" ? "Paid" : "Refunded"}</td>
              <td style={{ padding: "10px 0", color: "rgba(240,242,255,0.4)" }}>{new Date(e.enrolledAt).toLocaleDateString()}</td>
              <td style={{ padding: "10px 0", textAlign: "right", whiteSpace: "nowrap" }}>
                <a href={`mailto:${e.email}`} style={{ fontSize: "0.78rem", color: "var(--brand, #a78bfa)", textDecoration: "none", marginRight: "0.9rem" }}>
                  Email
                </a>
                {e.status === "ACTIVE" && (
                  <button
                    type="button"
                    onClick={() => resendLink(e.email)}
                    disabled={resendState[e.email] === "sending"}
                    style={{ fontSize: "0.78rem", color: resendState[e.email] === "error" ? "#f87171" : "var(--brand, #a78bfa)", background: "none", border: "none", cursor: "pointer", padding: 0, marginRight: "0.9rem" }}
                  >
                    {resendState[e.email] === "sending" ? "Sending…" : resendState[e.email] === "sent" ? "Sent!" : resendState[e.email] === "error" ? "Failed — retry" : "Resend link"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleStatus(e.email, e.status === "ACTIVE" ? "REVOKED" : "ACTIVE")}
                  style={{ fontSize: "0.78rem", color: e.status === "ACTIVE" ? "#f87171" : "#34d399", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  {e.status === "ACTIVE" ? "Revoke" : "Reactivate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
