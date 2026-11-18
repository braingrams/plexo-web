import { Template, PublishedDomain } from "@/lib/db/contentEntities";

export type AddressRow = {
  id: string;
  domain: string;
  type: "SUBDOMAIN" | "CUSTOM";
  siteId: string;
  siteName: string;
  /** Visitors can reach it right now. */
  online: boolean;
  pausedByPlan: boolean;
  /** Bought through Plexo. */
  bought: boolean;
};

/** Every web address across the organisation's sites, and the sites themselves (for "connect to which site?"). */
export async function loadAllAddresses(organizationId: string): Promise<{ sites: { id: string; name: string }[]; addresses: AddressRow[] }> {
  const { data: templates } = await Template.query.byOrg({ organizationId }).go({ pages: "all", attributes: ["id", "name", "kind", "parentId", "isBlogLayout", "isCommerceLayout", "isLmsPageDesign", "isSiteLayoutFragment", "marketplaceStatus", "updatedAt"] });
  const roots = templates
    .filter((t) => t.kind === "LANDING_PAGE" && !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isCommerceLayout && !t.isLmsPageDesign && !t.isSiteLayoutFragment)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const batches = await Promise.all(roots.map((t) => PublishedDomain.query.primary({ templateId: t.id }).go({ pages: "all" })));
  const names = new Map(roots.map((t) => [t.id, t.name || "Untitled site"]));
  const addresses = batches
    .flatMap((b) => b.data)
    .map((d): AddressRow => ({
      id: d.id,
      domain: d.domain,
      type: d.type === "CUSTOM" ? "CUSTOM" : "SUBDOMAIN",
      siteId: d.templateId,
      siteName: names.get(d.templateId) ?? "Untitled site",
      online: d.active !== false && !d.planDisabledAt && (d.type !== "CUSTOM" || d.certificateStatus === "ATTACHED"),
      pausedByPlan: !!d.planDisabledAt,
      bought: !!d.registeredDomainId,
    }))
    .sort((a, b) => a.siteName.localeCompare(b.siteName) || a.domain.localeCompare(b.domain));
  return { sites: roots.map((t) => ({ id: t.id, name: names.get(t.id)! })), addresses };
}

export type PaySummary = { dollars: string };
export const dollars = (cents: number | null | undefined): string | null => (typeof cents === "number" ? `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}` : null);
