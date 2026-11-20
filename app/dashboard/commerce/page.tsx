import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { Template } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { currentUserOnNewDashboard } from "@/lib/dashboardV3/hubRedirect";
import { commerceEntryHref, pickShopSiteId } from "@/lib/dashboardV3/commerceNav";
import { ButtonLink, EmptyState } from "../_v3/ui";
import { Store } from "lucide-react";
import { PageContainer } from "../_components/PageContainer";
import "./_components/cmx.css";

/** Commerce is scoped per site (own catalog, own Paystack keys — see CommerceSettings),
 * so this bare entry point has no data of its own to show: it sends the visitor straight
 * into their most-recently-updated site's Commerce module, where CommerceSiteSwitcher
 * lets them switch to a different one. An org with no sites yet gets a real empty state
 * instead of a silent redirect somewhere unrelated. */
export default async function CommerceRootPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const to = (await searchParams)?.to;
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");

  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: orgResolution.organizationId }).go({ pages: "all" });
  const eligibleSites = orgTemplates
    .filter((t) => !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const mostRecentSite = eligibleSites[0];

  // New dashboard: the "Orders" link opens the shop's Orders tab, in the shop that is switched on.
  if (await currentUserOnNewDashboard(session.user.id)) {
    const withShop = await Promise.all(eligibleSites.map(async (s) => ({ id: s.id, enabled: (await CommerceSettings.get({ templateId: s.id }).go()).data?.enabled ?? false })));
    const siteId = pickShopSiteId(withShop);
    if (siteId) redirect(commerceEntryHref(siteId, Array.isArray(to) ? to[0] : to));
    return (
      <div className="plx-page">
        <EmptyState
          title="Your shop starts with a website"
          body="Make your first website, then add what you sell. Your shop, basket and checkout are set up for you."
          action={<ButtonLink href="/dashboard/sites">Create a website</ButtonLink>}
          illustration={<Store size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />}
        />
      </div>
    );
  }

  if (mostRecentSite) {
    redirect(`/dashboard/commerce/${mostRecentSite.id}`);
  }

  return (
    <PageContainer>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
        gap: "0.75rem", padding: "4rem 1.5rem", borderRadius: 16,
        border: "1px dashed color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 12%, transparent)", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)",
      }}>
        <span style={{
          display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: 14,
          background: "color-mix(in srgb, var(--cmx-brand, rgb(var(--brand-rgb))) 12%, transparent)", color: "var(--cmx-accent, var(--brand-light))",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l2-5h14l2 5" /><path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" /><path d="M9 13a3 3 0 0 0 6 0" /></svg>
        </span>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)" }}>
          Commerce runs on a site
        </h2>
        <p style={{ fontSize: "0.85rem", color: "var(--cmx-muted, rgba(240,242,255,0.45))", maxWidth: 420 }}>
          Products, bookings, and orders all belong to one of your sites. Create a page first, then come back here to set up its catalog.
        </p>
        <Link
          href="/dashboard/templates"
          style={{
            marginTop: "0.5rem", display: "inline-flex", alignItems: "center", gap: "0.5rem",
            padding: "0.6rem 1.1rem", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700,
            background: "color-mix(in srgb, var(--cmx-brand, rgb(var(--brand-rgb))) 15%, transparent)", color: "var(--cmx-accent, var(--brand))", textDecoration: "none",
          }}
        >
          Go to Templates
        </Link>
      </div>
    </PageContainer>
  );
}
