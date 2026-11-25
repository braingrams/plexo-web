import { NextRequest, NextResponse } from "next/server";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { briefFromProfile } from "@/lib/onboarding/designs";
import { businessTypeById, inferBusinessType } from "@/lib/onboarding/businessType";
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
  if (!brief.industry && brief.about) {
    const { detectIndustry } = await import("@charisol/plexo-sdk/v2/compile");
    brief.industry = detectIndustry(brief);
  }
  const filters: PickerFilters = {
    q: typeof body.q === "string" ? body.q.slice(0, 80) : undefined,
    price: body.price === "free" || body.price === "paid" ? body.price : undefined,
    category: typeof body.category === "string" && body.category ? body.category.slice(0, 80) : undefined,
  };

  let listings;
  let owned = new Set<string>();
  let userId: string | null = null;
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
    userId = resolved.userId;
  }

  // The kind of business decides which designs fit: what the owner picked, else what SOL reads from their words, else a keyword reading.
  const { type, source } = await resolveBusinessType({ picked: parsed.value.brand?.businessType, name: parsed.value.brand?.name ?? "", about: parsed.value.brand?.about ?? "", goal: parsed.value.goal, userId });
  const ranked = rankListings(listings, parsed.value.goal, { name: brief.name, about: brief.about, industry: brief.industry, type });
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
      /** A new-editor design: previewed and personalized on its own data (the browser asks the server for its preview). */
      v2: d.designFormat === "v2" && d.sourceType === "BUILDER",
    })),
    total: filtered.length,
    page: pageOf.page,
    pageCount: pageOf.pageCount,
    categories,
    ...(type ? { businessType: { id: type, label: businessTypeById(type)?.label ?? type, source } } : {}),
  });
}

/** Picked by the owner > read by SOL from the name and description (free for them, rate limited) > keyword reading > none. Never throws. */
async function resolveBusinessType(i: { picked?: string; name: string; about: string; goal?: string; userId: string | null }): Promise<{ type: string | undefined; source: "picked" | "sol" | "guess" | "none" }> {
  if (i.picked && businessTypeById(i.picked)) return { type: i.picked, source: "picked" };
  const guess = inferBusinessType(i.name, i.about);
  const strong = guess && guess.confident ? guess.id : undefined;
  // SOL reads it when the words alone do not settle it, so a vague description still lands on the right kind of design.
  if (!strong && i.userId && process.env.NODE_ENV !== "development") {
    try {
      const { checkCommerceRateLimit } = await import("@/lib/commerceRateLimitDynamo");
      if (await checkCommerceRateLimit(`onboarding-business-type:${i.userId}`, 40, 60 * 60 * 1000)) {
        const { understandBusinessType } = await import("@/lib/onboarding/understand");
        const id = await understandBusinessType(i.name, i.about, i.goal);
        if (id) return { type: id, source: "sol" };
      }
    } catch (err) {
      console.error("market-designs: could not ask SOL for the kind of business, using the keyword reading:", err);
    }
  }
  if (guess && (guess.score >= 5 || (guess.score >= 3 && guess.margin >= 1.5))) return { type: guess.id, source: "guess" };
  return { type: undefined, source: "none" };
}
