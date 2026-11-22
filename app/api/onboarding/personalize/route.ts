import { NextRequest, NextResponse } from "next/server";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { personalizeTemplate } from "@/lib/onboarding/personalize";

const PERSONALIZATION_CREDIT_COST = 1;

/**
 * GET: Returns the credit cost and available credit balance for template personalization.
 * Adheres to SOL Rule 1: BYOK users pay 0 credits; Plexo AI users pay in AI credits.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { resolveUser } = await import("@/lib/auth/resolveUser");
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ cost: PERSONALIZATION_CREDIT_COST, availableCredits: 0 });
    }

    const { solRouteForUser } = await import("@/lib/ai/solEngine");
    const solRoute = await solRouteForUser(resolved.userId);
    const { ensureCreditPeriod } = await import("@/lib/db/ledgerOperations");
    const balance = await ensureCreditPeriod(resolved.userId).catch(() => ({ available: 0, total: 0 }));

    const cost = !("error" in solRoute) && solRoute.route.paidBy === "own-key" ? 0 : PERSONALIZATION_CREDIT_COST;
    return NextResponse.json({
      cost,
      availableCredits: balance.available,
      paidBy: !("error" in solRoute) ? solRoute.route.paidBy : "plexo",
    });
  } catch {
    return NextResponse.json({ cost: PERSONALIZATION_CREDIT_COST, availableCredits: 0 });
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
          cost: PERSONALIZATION_CREDIT_COST,
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
      cost: solRoute.route.paidBy === "own-key" ? 0 : PERSONALIZATION_CREDIT_COST,
      creditsRemaining: updated.available,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to personalize template." },
      { status: 500 }
    );
  }
}
