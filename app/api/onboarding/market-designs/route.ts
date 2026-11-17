import { NextRequest, NextResponse } from "next/server";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { briefFromProfile } from "@/lib/onboarding/designs";
import { filterListings, paginate, rankListings, topCategories, type PickerFilters } from "@/lib/onboarding/marketDesigns";

const PAGE_SIZE = 12;

/**
 * Real marketplace web page designs for the owner's goal, best fit first, with a flag for the ones they already own.
 * POST { profile, q?, price?: "free"|"paid", category?, page?, mock? } -> { designs, total, page, pageCount, categories }.
 * In `next dev` only, mock:true serves made-up designs so the screen can be viewed without a database.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { profile?: unknown; q?: unknown; price?: unknown; category?: unknown; page?: unknown; mock?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "We couldn't read that. Please try again." }, { status: 400 });
  }
  const mock = process.env.NODE_ENV === "development" && body.mock === true;
  const parsed = sanitizeBuildProfile(body.profile ?? {});
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const brief = briefFromProfile(parsed.value);
  const filters: PickerFilters = {
    q: typeof body.q === "string" ? body.q.slice(0, 80) : undefined,
    price: body.price === "free" || body.price === "paid" ? body.price : undefined,
    category: typeof body.category === "string" && body.category ? body.category.slice(0, 80) : undefined,
  };

  let listings;
  let owned = new Set<string>();
  if (mock) {
    listings = (await import("@/lib/onboarding/marketDesignsFixture")).FIXTURE_DESIGNS;
  } else {
    const { resolveUser } = await import("@/lib/auth/resolveUser");
    const resolved = await resolveUser(request);
    if (!resolved) return NextResponse.json({ error: "Please sign in again to continue." }, { status: 401 });
    const [{ listPublishedPageDesigns }, { TemplatePurchase }] = await Promise.all([import("@/lib/marketplace"), import("@/lib/db/contentEntities")]);
    listings = await listPublishedPageDesigns();
    const { data } = await TemplatePurchase.query.primary({ userId: resolved.userId }).go({ pages: "all" });
    owned = new Set(data.map((p) => p.templateId));
  }

  const ranked = rankListings(listings, parsed.value.goal, { name: brief.name, about: brief.about, industry: brief.industry });
  const categories = topCategories(ranked);
  const filtered = filterListings(ranked, filters);
  const pageOf = paginate(filtered, Number(body.page) || 1, PAGE_SIZE);
  return NextResponse.json({
    designs: pageOf.items.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      description: d.description,
      priceCents: d.priceCents,
      owned: owned.has(d.id),
      bestFit: d.bestFit,
      html: d.compiledHtml ?? null,
    })),
    total: filtered.length,
    page: pageOf.page,
    pageCount: pageOf.pageCount,
    categories,
  });
}
