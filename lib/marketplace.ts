import type { EntityItem } from "electrodb";

import { Template, TemplatePurchase } from "@/lib/db/contentEntities";

export interface MarketplaceFilters {
  category?: string;
  kind?: "EMAIL" | "LANDING_PAGE";
  free?: boolean;
  q?: string;
  sort?: "latest" | "popular";
  page?: number;
}

export interface MarketplaceListItem {
  id: string;
  name: string;
  kind: "EMAIL" | "LANDING_PAGE";
  category: string | null;
  description: string | null;
  priceCents: number;
  publishedAt: string | null;
  purchaseCount: number;
  compiledHtml?: string | null;
}

const PAGE_SIZE = 24;

export interface MarketplaceDetail extends MarketplaceListItem {
  owned: boolean;
}

async function purchaseCountFor(templateId: string): Promise<number> {
  const { data } = await TemplatePurchase.query.byTemplate({ templateId }).go();
  return data.length;
}

/** Used by app/marketplace/[id]'s Server Component — direct DB access, no self-fetch. */
export async function getMarketplaceTemplateDetail(id: string, userId: string | null): Promise<MarketplaceDetail | null> {
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.marketplaceStatus !== "PUBLISHED") return null;

  let owned = !template.priceCents || template.priceCents === 0;
  if (!owned && userId) {
    const { data: purchase } = await TemplatePurchase.get({ userId, templateId: id }).go();
    owned = !!purchase;
  }

  const purchaseCount = await purchaseCountFor(id);

  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    category: template.marketplaceCategory ?? null,
    description: template.marketplaceDescription ?? null,
    priceCents: template.priceCents ?? 0,
    publishedAt: template.marketplacePublishedAt ?? null,
    purchaseCount,
    compiledHtml: template.compiledHtml,
    owned,
  };
}

/**
 * Bounded scan over every PUBLISHED template — Template spent both of its GSI slots on
 * the two hot authenticated-dashboard access patterns (org list, page tree); marketplace-
 * wide browsing by marketplaceStatus has no dedicated index (documented gap, see
 * contentEntities.ts's own comment on the Template entity). Same discipline as
 * app/api/internal/scan-domains/route.ts: a cursor-driven `.scan`, filtered/sorted/
 * paginated in application code, not a speculative new GSI. Revisit if real marketplace
 * traffic/catalog size ever makes this worth a GSI3.
 */
async function scanPublishedTemplates(): Promise<EntityItem<typeof Template>[]> {
  const all: EntityItem<typeof Template>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: EntityItem<typeof Template>[]; cursor: string | null } = await Template.scan
      .where(({ marketplaceStatus }, { eq }) => eq(marketplaceStatus, "PUBLISHED"))
      .go({ cursor });
    all.push(...page.data);
    cursor = page.cursor;
    if (!cursor) break;
  }
  return all;
}

/**
 * Shared by app/api/v1/marketplace/templates (external/API consumers) and
 * app/marketplace (the browse page itself, called directly as a Server Component —
 * no self-HTTP-fetch) so the filter/sort logic lives in exactly one place.
 */
export async function listMarketplaceTemplates(
  filters: MarketplaceFilters,
): Promise<{ templates: MarketplaceListItem[]; total: number; categories: string[]; page: number; pageSize: number }> {
  const page = Math.max(1, filters.page ?? 1);

  const published = await scanPublishedTemplates();

  const categories = Array.from(
    new Set(published.map((t) => t.marketplaceCategory).filter((c): c is string => !!c)),
  );

  let filtered = published;
  if (filters.category) filtered = filtered.filter((t) => t.marketplaceCategory === filters.category);
  if (filters.kind) filtered = filtered.filter((t) => t.kind === filters.kind);
  if (filters.free === true) filtered = filtered.filter((t) => !t.priceCents || t.priceCents === 0);
  if (filters.free === false) filtered = filtered.filter((t) => (t.priceCents ?? 0) > 0);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    filtered = filtered.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.marketplaceDescription ?? "").toLowerCase().includes(q),
    );
  }

  const counts = new Map<string, number>();
  await Promise.all(filtered.map(async (t) => { counts.set(t.id, await purchaseCountFor(t.id)); }));

  const sorted = [...filtered].sort((a, b) => {
    if (filters.sort === "popular") {
      const diff = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
      if (diff !== 0) return diff;
    }
    return (b.marketplacePublishedAt ?? "").localeCompare(a.marketplacePublishedAt ?? "");
  });

  const total = sorted.length;
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return {
    templates: pageItems.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      category: t.marketplaceCategory ?? null,
      description: t.marketplaceDescription ?? null,
      priceCents: t.priceCents ?? 0,
      publishedAt: t.marketplacePublishedAt ?? null,
      purchaseCount: counts.get(t.id) ?? 0,
      compiledHtml: t.compiledHtml,
    })),
    total,
    categories,
    page,
    pageSize: PAGE_SIZE,
  };
}
