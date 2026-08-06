import { TemplateKind, Prisma } from "@prisma/client";

import { prisma } from "@/server/prisma";

export interface MarketplaceFilters {
  category?: string;
  kind?: TemplateKind;
  free?: boolean;
  q?: string;
  sort?: "latest" | "popular";
  page?: number;
}

export interface MarketplaceListItem {
  id: string;
  name: string;
  kind: TemplateKind;
  category: string | null;
  description: string | null;
  priceCents: number;
  publishedAt: Date | null;
  purchaseCount: number;
}

const PAGE_SIZE = 24;

export interface MarketplaceDetail extends MarketplaceListItem {
  owned: boolean;
}

/** Used by app/marketplace/[id]'s Server Component — direct DB access, no self-fetch. */
export async function getMarketplaceTemplateDetail(id: string, userId: string | null): Promise<MarketplaceDetail | null> {
  const template = await prisma.template.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      kind: true,
      marketplaceStatus: true,
      marketplaceCategory: true,
      marketplaceDescription: true,
      priceCents: true,
      marketplacePublishedAt: true,
      _count: { select: { purchases: true } },
    },
  });
  if (!template || template.marketplaceStatus !== "PUBLISHED") return null;

  let owned = !template.priceCents || template.priceCents === 0;
  if (!owned && userId) {
    const purchase = await prisma.templatePurchase.findUnique({
      where: { userId_templateId: { userId, templateId: id } },
    });
    owned = !!purchase;
  }

  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    category: template.marketplaceCategory,
    description: template.marketplaceDescription,
    priceCents: template.priceCents ?? 0,
    publishedAt: template.marketplacePublishedAt,
    purchaseCount: template._count.purchases,
    owned,
  };
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

  // `free` and `q` each need their own OR clause — spreading both directly onto `where`
  // would collide on the "OR" key (the second spread silently overwrites the first), so
  // combining "free only" with a search term used to drop the free-only filter entirely.
  // AND keeps each OR clause distinct.
  const andClauses: Prisma.TemplateWhereInput[] = [];
  if (filters.free === true) andClauses.push({ OR: [{ priceCents: null }, { priceCents: 0 }] });
  if (filters.q) {
    andClauses.push({
      OR: [
        { name: { contains: filters.q, mode: "insensitive" } },
        { marketplaceDescription: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.TemplateWhereInput = {
    marketplaceStatus: "PUBLISHED",
    ...(filters.category ? { marketplaceCategory: filters.category } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.free === false ? { priceCents: { gt: 0 } } : {}),
    ...(andClauses.length ? { AND: andClauses } : {}),
  };

  const orderBy: Prisma.TemplateOrderByWithRelationInput =
    filters.sort === "popular" ? { purchases: { _count: "desc" } } : { marketplacePublishedAt: "desc" };

  const [templates, total, categoryRows] = await Promise.all([
    prisma.template.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        kind: true,
        marketplaceCategory: true,
        marketplaceDescription: true,
        priceCents: true,
        marketplacePublishedAt: true,
        _count: { select: { purchases: true } },
      },
    }),
    prisma.template.count({ where }),
    prisma.template.findMany({
      where: { marketplaceStatus: "PUBLISHED", marketplaceCategory: { not: null } },
      distinct: ["marketplaceCategory"],
      select: { marketplaceCategory: true },
    }),
  ]);

  return {
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      category: t.marketplaceCategory,
      description: t.marketplaceDescription,
      priceCents: t.priceCents ?? 0,
      publishedAt: t.marketplacePublishedAt,
      purchaseCount: t._count.purchases,
    })),
    total,
    categories: categoryRows.map((c) => c.marketplaceCategory).filter((c): c is string => !!c),
    page,
    pageSize: PAGE_SIZE,
  };
}
