import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { LmsFunnel } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { PageContainer } from "../_components/PageContainer";
import { NewFunnelLauncher } from "./_components/NewFunnelLauncher";

/** Funnels are scoped per site (own pages, own enrollments — see LmsFunnel), so this bare
 * entry point has no data of its own: it sends the visitor straight into their
 * most-recently-updated funnel. An org with none yet gets a real empty state that starts
 * the "New Funnel" flow — same dispatcher shape as /dashboard/commerce/page.tsx. */
export default async function FunnelsRootPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");

  const [{ data: funnels }, { data: user }] = await Promise.all([
    LmsFunnel.query.byOrg({ organizationId: orgResolution.organizationId }).go({ pages: "all" }),
    User.get({ id: session.user.id }).go(),
  ]);

  const mostRecent = [...funnels].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  if (mostRecent) {
    redirect(`/dashboard/funnels/${mostRecent.templateId}`);
  }

  return (
    <PageContainer>
      <div
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
          gap: "0.75rem", padding: "4rem 1.5rem", borderRadius: 16,
          border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)",
        }}
      >
        <span style={{
          display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: 14,
          background: "rgba(139,92,246,0.12)", color: "#c084fc",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
          </svg>
        </span>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff" }}>
          Build your first funnel
        </h2>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.45)", maxWidth: 420 }}>
          A funnel guides visitors from signup through a sequence of pages you design — welcome screen, lessons, whatever you need — free or paid, at your own pace.
        </p>
        <NewFunnelLauncher initialFunnelBuilderLevel={user?.funnelBuilderLevel ?? null} />
      </div>
    </PageContainer>
  );
}
