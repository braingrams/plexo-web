import { NextRequest, NextResponse } from "next/server";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { describePlace } from "@/lib/onboarding/place";
import { PlainError, extractTextNodes, finishDesign, planPersonalization, writeCopy, MAX_NODES } from "@/lib/onboarding/solPersonalize";

export const maxDuration = 120;

/**
 * GET: Returns the credit cost and available credit balance for template personalization.
 * Adheres to SOL Rule 1: BYOK users pay 0 credits; Plexo AI users pay based on real model token cost.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { resolveUser } = await import("@/lib/auth/resolveUser");
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ cost: 20, availableCredits: 0 });
    }

    const { solRouteForUser, tierFor } = await import("@/lib/ai/solEngine");
    const solRoute = await solRouteForUser(resolved.userId);
    const { ensureCreditPeriod, estimateWorstCaseCost } = await import("@/lib/db/ledgerOperations");
    const balance = await ensureCreditPeriod(resolved.userId).catch(() => ({ available: 0, total: 0 }));

    if (!("error" in solRoute) && solRoute.route.paidBy === "own-key") {
      return NextResponse.json({
        cost: 0,
        availableCredits: balance.available,
        paidBy: "own-key",
      });
    }

    const tier = !("error" in solRoute) ? tierFor(solRoute.route, solRoute.plan, "MEDIUM") : "BASIC";
    const provider = !("error" in solRoute) ? solRoute.route.provider : "bedrock_claude";
    // Upper estimate: SOL reads the design's words (~14,000 characters at most) and writes them back (~6,000 tokens).
    const cost = estimateWorstCaseCost(provider, tier, "edit_raw_html", 14000, 6000);

    return NextResponse.json({
      cost,
      availableCredits: balance.available,
      paidBy: "plexo",
    });
  } catch {
    return NextResponse.json({ cost: 20, availableCredits: 0 });
  }
}

/**
 * POST: SOL tailors a chosen design to the owner's business in short stages, so the SOL Studio can
 * show real progress and ask real questions in between (`stage` in the body):
 *   "plan"   → { domain, summary, questions }       SOL reads the brand + design, decides what to ask.
 *   "write"  → { replacements }                      SOL rewrites the design's words (charged).
 *   "finish" → { html, summary, creditsRemaining }   puts it together; no AI, no charge.
 * Follows the SOL engine rules (lib/ai/solEngine.ts): which AI (Plexo's or the owner's own key),
 * which tier, and an affordability check before each AI stage.
 */
/** Where the owner is: the network edge's city and country when it forwards them, else the browser's time zone and language. */
function ownerPlace(request: NextRequest, fromBrowser: unknown): string | undefined {
  const h = request.headers;
  const b = fromBrowser && typeof fromBrowser === "object" ? (fromBrowser as { timeZone?: unknown; locale?: unknown }) : {};
  return describePlace({
    city: h.get("cloudfront-viewer-city") ?? h.get("x-vercel-ip-city") ?? undefined,
    country: h.get("cloudfront-viewer-country-name") ?? h.get("x-vercel-ip-country") ?? undefined,
    timeZone: typeof b.timeZone === "string" ? b.timeZone : undefined,
    locale: typeof b.locale === "string" ? b.locale : undefined,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { resolveUser } = await import("@/lib/auth/resolveUser");
    const resolved = await resolveUser(request);
    if (!resolved) return NextResponse.json({ error: "Please sign in again to continue." }, { status: 401 });

    const { solRouteForUser, tierFor, checkCanAfford } = await import("@/lib/ai/solEngine");
    const solRoute = await solRouteForUser(resolved.userId);
    if ("error" in solRoute) return NextResponse.json({ error: solRoute.error }, { status: solRoute.status });

    const body = await request.json().catch(() => ({}));
    const stage = body.stage === "plan" || body.stage === "write" || body.stage === "finish" ? (body.stage as "plan" | "write" | "finish") : null;
    if (!stage) return NextResponse.json({ error: "Something went wrong starting SOL. Please try again." }, { status: 400 });
    const parsed = sanitizeBuildProfile(body.profile ?? {});
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
    const design = { name: text(body.templateName, 200), description: text(body.templateDescription, 600) };
    const templateHtml = typeof body.templateHtml === "string" && body.templateHtml.trim() ? body.templateHtml : undefined;
    if (!templateHtml) return NextResponse.json({ error: "Pick a design first, then ask SOL to personalize it." }, { status: 400 });
    if (templateHtml.length > 2_000_000) return NextResponse.json({ error: "This design is too large to personalize. Pick another one." }, { status: 413 });

    const brandInfo = parsed.value.brand;
    const brand = { name: text(brandInfo?.name, 120) ?? "Your Brand", about: text(brandInfo?.about, 500) ?? "", goal: parsed.value.goal || "business-site", place: ownerPlace(request, body.place) };
    const { ensureCreditPeriod } = await import("@/lib/db/ledgerOperations");
    const balanceOf = () => ensureCreditPeriod(resolved.userId).catch(() => ({ available: 0, total: 0 }));

    if (stage === "finish") {
      const replacements: Record<string, string> = {};
      if (body.replacements && typeof body.replacements === "object") {
        for (const [k, v] of Object.entries(body.replacements as Record<string, unknown>)) if (typeof v === "string") replacements[k] = v;
      }
      const domain = text(body.domain, 40) ?? "other";
      const html = finishDesign({ html: templateHtml, replacements, name: brand.name, domain, design, brandColor: brandInfo?.colors?.[0], logoUrl: brandInfo?.logoUrl });
      const updated = await balanceOf();
      return NextResponse.json({ html, summary: `SOL wrote your headlines, cards and buttons for "${brand.name}".`, creditsRemaining: updated.available });
    }

    const tier = tierFor(solRoute.route, solRoute.plan, "MEDIUM");
    const nodes = extractTextNodes(templateHtml);
    if (nodes.length === 0) return NextResponse.json({ error: "This design has no words SOL can change. Pick another one." }, { status: 400 });
    const approxChars = nodes.reduce((n, x) => n + x.text.length, 0) + 3000;
    const cannotAfford = await checkCanAfford(resolved.userId, solRoute.route, tier, "edit_raw_html", approxChars);
    if (cannotAfford) {
      const balance = await balanceOf();
      return NextResponse.json({ error: "You don't have enough AI credits to personalize your website with SOL. Top up to continue.", outOfCredits: true, availableCredits: balance.available }, { status: 402 });
    }
    const ctx = { route: solRoute.route, tier, userId: resolved.userId };

    if (stage === "plan") {
      const plan = await planPersonalization(ctx, brand, design, nodes);
      return NextResponse.json(plan);
    }

    const answers = Array.isArray(body.answers)
      ? (body.answers as Array<{ question?: unknown; answer?: unknown }>)
          .map((a) => ({ question: text(a?.question, 200) ?? "", answer: text(a?.answer, 300) ?? "" }))
          .filter((a) => a.question && a.answer)
          .slice(0, 6)
      : [];
    const replacements = await writeCopy(ctx, brand, design, nodes.slice(0, MAX_NODES), answers);
    return NextResponse.json({ replacements });
  } catch (err) {
    console.warn("[onboarding/personalize]", err);
    if (err instanceof PlainError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: "SOL hit a snag while personalizing. Please try again: nothing was changed." }, { status: 500 });
  }
}
