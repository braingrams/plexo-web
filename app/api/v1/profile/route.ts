import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getDomainLimit } from "@/lib/domainLimit";
import { getTierFeatures } from "@/lib/subscription";
import { User } from "@/lib/db/coreEntities";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";

/**
 * GET /api/v1/profile
 *
 * Retrieves authenticated user details, subscription plan, remaining credits,
 * domain usage, and template limits.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: user } = await User.get({ id: resolved.userId }).go();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Template/PublishedDomain have no userId index (see contentEntities.ts) — only
    // organizationId. Fan out over the org's templates (same discipline as
    // app/dashboard/page.tsx) and filter to this specific user's rows in memory, so the
    // counts match the original per-user semantics exactly rather than counting the
    // whole org.
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const userTemplates = orgTemplates.filter((t) => t.userId === user.id);

    const emailTemplateCount = userTemplates.filter((t) => t.kind === "EMAIL").length;
    // Blog post/listing layouts are internal-only Template rows, not real pages —
    // excluded here the same way plan-limit counts exclude them elsewhere.
    const landingPageCount = userTemplates.filter(
      (t) => t.kind === "LANDING_PAGE" && !t.isBlogLayout && !t.isSiteLayoutFragment,
    ).length;

    const domainBatches = await Promise.all(
      orgTemplates.map((t) => PublishedDomain.query.primary({ templateId: t.id }).go()),
    );
    const domainCount = domainBatches.reduce((sum, batch) => sum + batch.data.filter((d) => d.userId === user.id).length, 0);

    const features = getTierFeatures(user.subscriptionPlan ?? "FREE");
    const domainLimit = getDomainLimit(user.subscriptionPlan ?? "FREE", user.customDomainLimit ?? null);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image ?? null,
        subscriptionPlan: user.subscriptionPlan ?? "FREE",
        allowanceBalance: user.allowanceBalance ?? 0,
        topupBalance: user.topupBalance ?? 0,
        totalCredits: (user.allowanceBalance ?? 0) + (user.topupBalance ?? 0),
        layoutMode: user.layoutMode ?? "CLASSIC",
        createdAt: user.createdAt,
      },
      limits: {
        domains: {
          used: domainCount,
          limit: domainLimit,
        },
        emailTemplates: {
          used: emailTemplateCount,
          limit: features.maxEmailTemplates,
        },
        landingPages: {
          used: landingPageCount,
          limit: features.maxLandingPages,
        },
      },
      features,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
