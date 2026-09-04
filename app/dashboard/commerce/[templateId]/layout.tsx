import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { PageContainer } from "../../_components/PageContainer";
import { CommerceSiteHeader, type CommerceSiteInfo } from "../_components/CommerceSiteHeader";
import { CommerceTabs } from "../_components/CommerceTabs";

/** Shell for every /dashboard/commerce/[templateId]/* route: validates the site in the
 * URL actually belongs to the caller's active org (parentId: null — a "site" is always a
 * root Template, same convention Blog/Pages already use), then renders the site header +
 * section tabs above whatever the page renders. This is the one place that check happens —
 * leaf pages below trust it, since a failed check redirects/404s before any child renders.
 *
 * One plain page, not shell-specific chrome: both dashboard shells (Modern's topbar,
 * Classic's sidebar) render this exact same content unchanged — it's ordinary
 * PageContainer content, same as every other dashboard page, not a second sidebar. */
export default async function CommerceSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");
  const organizationId = orgResolution.organizationId;

  const [{ data: site }, { data: orgTemplates }] = await Promise.all([
    Template.get({ id: templateId }).go(),
    Template.query.byOrg({ organizationId }).go({ pages: "all" }),
  ]);

  if (!site || site.organizationId !== organizationId || site.parentId) notFound();

  const eligibleSites = orgTemplates
    .filter((t) => !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  // Site identity needs more than just a name to be unmistakable: whether Commerce is
  // actually live for it (CommerceSettings.enabled) and its published domain, if any (same
  // PublishedDomain join app/dashboard/pages/page.tsx already uses for the same purpose).
  const sites: CommerceSiteInfo[] = await Promise.all(
    eligibleSites.map(async (t) => {
      const [{ data: settings }, { data: domains }] = await Promise.all([
        CommerceSettings.get({ templateId: t.id }).go(),
        PublishedDomain.query.primary({ templateId: t.id }).where((attr, op) => op.eq(attr.active, true)).go(),
      ]);
      return {
        id: t.id,
        name: t.name,
        domain: domains[0]?.domain ?? null,
        enabled: settings?.enabled ?? false,
      };
    }),
  );

  const currentSite = sites.find((s) => s.id === templateId) ?? { id: templateId, name: site.name, domain: null, enabled: false };
  const otherSites = sites.filter((s) => s.id !== templateId);

  return (
    <PageContainer>
      <CommerceSiteHeader currentSite={currentSite} otherSites={otherSites} currentTemplateId={templateId} />
      <CommerceTabs templateId={templateId} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </PageContainer>
  );
}
