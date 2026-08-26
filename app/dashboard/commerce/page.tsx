import { redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { PageContainer } from "../_components/PageContainer";

/** Commerce is scoped per site (own catalog, own Paystack keys — see CommerceSettings),
 * so this bare entry point has no data of its own to show: it sends the visitor straight
 * into their most-recently-updated site's Commerce module, where CommerceSiteSwitcher
 * lets them switch to a different one. An org with no sites yet gets a real empty state
 * instead of a silent redirect somewhere unrelated. */
export default async function CommerceRootPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) redirect("/auth/login");

  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");

  const mostRecentSite = await prisma.template.findFirst({
    where: { organizationId: orgResolution.organizationId, parentId: null, marketplaceStatus: null, isBlogLayout: false, isSiteLayoutFragment: false, isCommerceLayout: false },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });

  if (mostRecentSite) {
    redirect(`/dashboard/commerce/${mostRecentSite.id}`);
  }

  return (
    <PageContainer>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
        gap: "0.75rem", padding: "4rem 1.5rem", borderRadius: 16,
        border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)",
      }}>
        <span style={{
          display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: 14,
          background: "rgba(139,92,246,0.12)", color: "#c084fc",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l2-5h14l2 5" /><path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" /><path d="M9 13a3 3 0 0 0 6 0" /></svg>
        </span>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff" }}>
          Commerce runs on a site
        </h2>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.45)", maxWidth: 420 }}>
          Products, bookings, and orders all belong to one of your sites. Create a page first, then come back here to set up its catalog.
        </p>
        <Link
          href="/dashboard/templates"
          style={{
            marginTop: "0.5rem", display: "inline-flex", alignItems: "center", gap: "0.5rem",
            padding: "0.6rem 1.1rem", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700,
            background: "rgba(139,92,246,0.15)", color: "var(--brand)", textDecoration: "none",
          }}
        >
          Go to Templates
        </Link>
      </div>
    </PageContainer>
  );
}
