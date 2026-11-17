/**
 * Which stored templates are "a site" for the new dashboard, and how they're shown. Pure.
 * A site is a root landing page of any kind: built with the editor, an uploaded page, a
 * WordPress site that moved in, a React app, or a funnel/course. Layout fragments, blog and
 * store layouts, lesson designs, emails, marketplace listings and sub-pages are never sites.
 */
import { readSiteBrand } from "./brandLook";
import { siteKindOf, type SiteSummary } from "./sites";

export type TemplateRow = {
  id: string;
  name?: string | null;
  kind?: string | null;
  parentId?: string | null;
  marketplaceStatus?: string | null;
  isBlogLayout?: boolean | null;
  isSiteLayoutFragment?: boolean | null;
  isCommerceLayout?: boolean | null;
  isLmsPageDesign?: boolean | null;
  isLmsFunnel?: boolean | null;
  sourceType?: string | null;
  migratedFrom?: string | null;
  updatedAt?: string | null;
  brand?: unknown;
};

export type DomainRow = { templateId: string; domain: string; type?: string | null; active?: boolean | null; organizationId?: string | null };

export function isRealSite(t: TemplateRow): boolean {
  // Older rows can have no `kind` written; only an explicit EMAIL is excluded.
  if (t.kind && t.kind !== "LANDING_PAGE") return false;
  return !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign;
}

/** Each site's web address: their own domain if they have one, else the free one. Other workspaces' domains are ignored. */
export function liveAddresses(domains: DomainRow[], organizationId?: string): Map<string, string> {
  const live = new Map<string, string>();
  for (const d of domains) {
    if (d.active === false) continue;
    if (organizationId && d.organizationId && d.organizationId !== organizationId) continue;
    if (!live.has(d.templateId) || d.type === "CUSTOM") live.set(d.templateId, d.domain);
  }
  return live;
}

export function summarizeSites(templates: TemplateRow[], domains: DomainRow[], organizationId?: string): SiteSummary[] {
  const live = liveAddresses(domains, organizationId);
  return templates
    .filter(isRealSite)
    .map((t) => ({
      id: t.id,
      name: t.name?.trim() || "Untitled site",
      kind: siteKindOf({ sourceType: t.sourceType, isLmsFunnel: t.isLmsFunnel }),
      status: live.has(t.id) ? ("live" as const) : ("draft" as const),
      address: live.get(t.id) ?? null,
      updatedAt: t.updatedAt ?? null,
      ...(readSiteBrand(t.brand) ? { brand: readSiteBrand(t.brand) } : {}),
      ...(t.migratedFrom ? { movedFrom: t.migratedFrom } : {}),
    }))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}
