import { NextRequest, NextResponse } from "next/server";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { personalizeTemplate } from "@/lib/onboarding/personalize";

const PERSONALIZATION_CREDIT_COST = 1;

/**
 * GET: Returns the credit cost and available credit balance for template personalization.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { resolveUser } = await import("@/lib/auth/resolveUser");
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ cost: PERSONALIZATION_CREDIT_COST, availableCredits: 0 });
    }
    const { ensureCreditPeriod } = await import("@/lib/db/ledgerOperations");
    const balance = await ensureCreditPeriod(resolved.userId).catch(() => ({ available: 0, total: 0 }));
    return NextResponse.json({
      cost: PERSONALIZATION_CREDIT_COST,
      availableCredits: balance.available,
    });
  } catch {
    return NextResponse.json({ cost: PERSONALIZATION_CREDIT_COST, availableCredits: 0 });
  }
}

/**
 * POST: Deeply personalizes a template with SOL. Checks and charges 1 AI credit.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { resolveUser } = await import("@/lib/auth/resolveUser");
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ error: "Please sign in again to continue." }, { status: 401 });
    }

    const { ensureCreditPeriod, chargeFlatCredits } = await import("@/lib/db/ledgerOperations");
    const balance = await ensureCreditPeriod(resolved.userId);

    if (balance.available < PERSONALIZATION_CREDIT_COST) {
      return NextResponse.json(
        {
          error: "You need 1 AI credit to personalize your website with SOL.",
          outOfCredits: true,
          availableCredits: balance.available,
          cost: PERSONALIZATION_CREDIT_COST,
        },
        { status: 402 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = sanitizeBuildProfile(body.profile ?? {});
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const designId = typeof body.designId === "string" ? body.designId : undefined;
    const templateHtml = typeof body.templateHtml === "string" && body.templateHtml.trim() ? body.templateHtml : undefined;
    const templateName = typeof body.templateName === "string" && body.templateName.trim() ? body.templateName.trim() : undefined;
    const templateDescription = typeof body.templateDescription === "string" && body.templateDescription.trim() ? body.templateDescription.trim() : undefined;

    const result = await personalizeTemplate({
      profile: parsed.value,
      designId,
      templateHtml,
      templateName,
      templateDescription,
    });

    // Debit 1 credit atomically
    await chargeFlatCredits(resolved.userId, PERSONALIZATION_CREDIT_COST, "Personalize template with SOL");
    const updated = await ensureCreditPeriod(resolved.userId).catch(() => balance);

    return NextResponse.json({
      ...result,
      cost: PERSONALIZATION_CREDIT_COST,
      creditsRemaining: updated.available,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to personalize template." },
      { status: 500 }
    );
  }
}
