import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { getDomainLimit, resolveUser } from "../domains/route";
import { getTierFeatures } from "@/lib/subscription";

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
    const user = await prisma.user.findUnique({
      where: { id: resolved.userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        subscriptionPlan: true,
        allowanceBalance: true,
        topupBalance: true,
        customDomainLimit: true,
        layoutMode: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const domainCount = await prisma.publishedDomain.count({
      where: { userId: user.id },
    });

    const emailTemplateCount = await prisma.template.count({
      where: { userId: user.id, kind: "EMAIL" },
    });
    const landingPageCount = await prisma.template.count({
      where: { userId: user.id, kind: "LANDING_PAGE" },
    });

    const features = getTierFeatures(user.subscriptionPlan);
    const domainLimit = getDomainLimit(user.subscriptionPlan, user.customDomainLimit);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        subscriptionPlan: user.subscriptionPlan,
        allowanceBalance: user.allowanceBalance,
        topupBalance: user.topupBalance,
        totalCredits: user.allowanceBalance + user.topupBalance,
        layoutMode: user.layoutMode,
        createdAt: user.createdAt.toISOString(),
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
