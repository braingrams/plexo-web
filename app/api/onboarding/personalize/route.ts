import { NextRequest, NextResponse } from "next/server";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { personalizeTemplate } from "@/lib/onboarding/personalize";

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
    // Realistic credit estimate for a template HTML with ~3,000 output tokens
    const cost = estimateWorstCaseCost(provider, tier, "edit_raw_html", 12000, 3000);

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
 * POST: Deeply personalizes a template with SOL.
 * Adheres to SOL Engine rules (lib/ai/solEngine.ts):
 * 1. Which AI: routes via solRouteForUser (Plexo's AI or own BYOK key).
 * 2. Which tier: tierFor (Basic for Free accounts, Medium for paid).
 * 3. Paying: checkCanAfford pre-flight gate, charged usage via chargeFor afterwards.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { resolveUser } = await import("@/lib/auth/resolveUser");
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ error: "Please sign in again to continue." }, { status: 401 });
    }

    const { solRouteForUser, tierFor, checkCanAfford } = await import("@/lib/ai/solEngine");
    const solRoute = await solRouteForUser(resolved.userId);
    if ("error" in solRoute) {
      return NextResponse.json({ error: solRoute.error }, { status: solRoute.status });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = sanitizeBuildProfile(body.profile ?? {});
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const designId = typeof body.designId === "string" ? body.designId : undefined;
    const templateHtml = typeof body.templateHtml === "string" && body.templateHtml.trim() ? body.templateHtml : undefined;
    const templateName = typeof body.templateName === "string" && body.templateName.trim() ? body.templateName.trim() : undefined;
    const templateDescription = typeof body.templateDescription === "string" && body.templateDescription.trim() ? body.templateDescription.trim() : undefined;

    const tier = tierFor(solRoute.route, solRoute.plan, "MEDIUM");
    const approxChars = (templateHtml?.length ?? 12000) + 2000;
    const { estimateWorstCaseCost } = await import("@/lib/db/ledgerOperations");
    const estimatedCost = solRoute.route.paidBy === "own-key" ? 0 : estimateWorstCaseCost(solRoute.route.provider, tier, "edit_raw_html", approxChars, 3000);

    // SOL Rule 3: pre-flight affordability check before running
    const cannotAfford = await checkCanAfford(resolved.userId, solRoute.route, tier, "edit_raw_html", approxChars);
    if (cannotAfford) {
      const { ensureCreditPeriod } = await import("@/lib/db/ledgerOperations");
      const balance = await ensureCreditPeriod(resolved.userId).catch(() => ({ available: 0, total: 0 }));
      return NextResponse.json(
        {
          error: "You don't have enough AI credits to personalize your website with SOL. Top up to continue.",
          outOfCredits: true,
          availableCredits: balance.available,
          cost: estimatedCost,
        },
        { status: 402 }
      );
    }

    const result = await personalizeTemplate({
      profile: parsed.value,
      designId,
      templateHtml,
      templateName,
      templateDescription,
      userId: resolved.userId,
      solRoute: { route: solRoute.route, tier },
    });

    const { ensureCreditPeriod } = await import("@/lib/db/ledgerOperations");
    const updated = await ensureCreditPeriod(resolved.userId).catch(() => ({ available: 0, total: 0 }));

    return NextResponse.json({
      ...result,
      cost: estimatedCost,
      creditsRemaining: updated.available,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to personalize template." },
      { status: 500 }
    );
  }
}
