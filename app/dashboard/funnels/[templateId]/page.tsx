import Link from "next/link";
import { auth } from "@/server/authDynamo";
import { LmsFunnel, LmsPage, LmsEnrollment } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { SetupChecklist } from "./_components/SetupChecklist";

function StatTile({ label, value, tint, icon }: { label: string; value: string; tint: string; icon: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, minWidth: 150, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 14, padding: "1rem 1.1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
    }}>
      <div>
        <div style={{ fontSize: "1.5rem", fontWeight: 600, color: "#f0f2ff", fontVariantNumeric: "tabular-nums" }}>{value}</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", marginTop: 2 }}>{label}</div>
      </div>
      <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: tint, display: "grid", placeItems: "center" }}>{icon}</div>
    </div>
  );
}

export default async function FunnelOverviewPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const session = await auth();

  const [{ data: funnel }, { data: pages }, { data: enrollments }, { data: user }] = await Promise.all([
    LmsFunnel.get({ templateId }).go(),
    LmsPage.query.byOrder({ templateId }).go({ pages: "all" }),
    LmsEnrollment.query.byEnrolledAt({ templateId }).go({ pages: "all" }),
    session?.user ? User.get({ id: session.user.id }).go() : Promise.resolve({ data: null }),
  ]);

  const activeEnrollments = enrollments.filter((e) => e.status === "ACTIVE");
  const completedCount = enrollments.filter((e) => e.completedAt).length;

  return (
    <div>
      {!funnel?.enabled && (
        <Link
          href={`/dashboard/funnels/${templateId}/settings`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
            background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)",
            borderRadius: 12, padding: "0.8rem 1.1rem", marginBottom: "1.25rem",
            fontSize: "0.83rem", color: "#c4b5fd", textDecoration: "none",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
            This funnel is off — nothing here is visible to visitors until you publish it in Settings.
          </span>
          <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>Go to Settings →</span>
        </Link>
      )}

      {user?.funnelBuilderLevel === "INTERMEDIATE" && (
        <SetupChecklist templateId={templateId} hasPage={pages.length > 0} enabled={!!funnel?.enabled} signupConfigured={funnel?.signupMode === "PAID" ? !!funnel.signupProductId : true} />
      )}

      <div style={{ display: "flex", gap: "0.85rem", flexWrap: "wrap", marginBottom: "1.75rem" }}>
        <StatTile
          label="Pages"
          value={String(pages.length)}
          tint="rgba(139,92,246,0.16)"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>}
        />
        <StatTile
          label="Enrolled"
          value={String(activeEnrollments.length)}
          tint="rgba(96,165,250,0.16)"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /></svg>}
        />
        <StatTile
          label="Completed"
          value={String(completedCount)}
          tint="rgba(52,211,153,0.16)"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.8"><path d="M20 6L9 17l-5-5" /></svg>}
        />
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.25rem 1.4rem" }}>
        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.9rem" }}>Recent signups</div>
        {activeEnrollments.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "rgba(240,242,255,0.4)" }}>
            <p style={{ fontSize: "0.85rem", margin: 0 }}>No one has signed up yet — they'll show up here once your funnel is live.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ color: "rgba(240,242,255,0.4)", textAlign: "left" }}>
                  <th style={{ fontWeight: 500, paddingBottom: 8 }}>Name</th>
                  <th style={{ fontWeight: 500, paddingBottom: 8 }}>Email</th>
                  <th style={{ fontWeight: 500, paddingBottom: 8 }}>Progress</th>
                  <th style={{ fontWeight: 500, paddingBottom: 8 }}>Signed up</th>
                </tr>
              </thead>
              <tbody>
                {activeEnrollments.slice(0, 6).map((e) => (
                  <tr key={e.email} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e2e4f5" }}>
                    <td style={{ padding: "10px 0" }}>{e.name || "—"}</td>
                    <td style={{ padding: "10px 0" }}>{e.email}</td>
                    <td style={{ padding: "10px 0", color: "rgba(240,242,255,0.55)" }}>{e.completedPageCount ?? 0} / {pages.length}</td>
                    <td style={{ padding: "10px 0", color: "rgba(240,242,255,0.4)" }}>{new Date(e.enrolledAt ?? Date.now()).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
