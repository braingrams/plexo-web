import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveManageLandingPagePublishing, canWhiteLabel, getOrganizationOwnerPlan } from "@/lib/subscription";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Resolved only when the org is entitled (Pro/Ultra owner plan) and has actually set
 * branding — otherwise omitted from the response entirely, so a Free-tier embed (or one
 * from an org that hasn't configured anything) keeps plexo-sdk's default Plexo splash.
 * See plexo-sdk's useApiKeyValidation.ts, which consumes this field.
 */
async function resolveSdkBranding(
  organizationId: string,
): Promise<{ name: string; logoUrl?: string; brandColor?: string } | undefined> {
  const plan = await getOrganizationOwnerPlan(organizationId);
  if (!canWhiteLabel(plan)) return undefined;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, logo: true, brandColor: true },
  });
  if (!org || (!org.logo && !org.brandColor)) return undefined;
  return { name: org.name, logoUrl: org.logo ?? undefined, brandColor: org.brandColor ?? undefined };
}

/**
 * GET /api/v1/validate-key
 *
 * Validates the supplied API key or dashboard session ('workspace-internal')
 * and returns the authenticated user's subscription plan and active limits.
 *
 * Headers:
 *   x-api-key: <raw api key> | "workspace-internal"
 *
 * Responses:
 *   200 { valid: true, plan: "FREE" | "PRO" | "ULTRA", useAi: boolean, aiProvider: string, aiTier: string, manageLandingPagePublishing: boolean, branding?: { name: string, logoUrl?: string, brandColor?: string } }
 *   branding is present only for orgs entitled to (and who've configured) white-labeling —
 *   see resolveSdkBranding below and plexo-sdk's useApiKeyValidation.ts, which consumes it.
 *   400 { valid: false, error: "API key is required." }
 *   401 { valid: false, error: "Invalid key or unauthorized." }
 *   500 { valid: false, error: "Internal server error." }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawKey = request.headers.get("x-api-key")?.trim();

  if (!rawKey) {
    return NextResponse.json(
      { valid: false, error: "API key is required." },
      { status: 400 }
    );
  }

  try {
    let subscriptionPlan = "FREE";
    let useAi = false;
    let aiProvider = "openai";
    let aiTier = "AUTO";
    let aiAccessMode = "SYSTEM";
    let manageLandingPagePublishing = false;
    let branding: Awaited<ReturnType<typeof resolveSdkBranding>>;

    if (rawKey === "workspace-internal") {
      const { auth } = await import("@/server/auth");
      const session = await auth.api.getSession({ headers: request.headers });

      if (!session?.user) {
        return NextResponse.json(
          { valid: false, error: "Unauthorized: No active session found." },
          { status: 401 }
        );
      }

      const user = await (prisma.user.findUnique as any)({
        where: { id: session.user.id },
        select: {
          subscriptionPlan: true,
          manageLandingPagePublishing: true,
          apiKeys: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { useAi: true, aiProvider: true, aiTier: true, aiAccessMode: true },
          },
        },
      });

      if (!user) {
        return NextResponse.json(
          { valid: false, error: "Authenticated user not found." },
          { status: 401 }
        );
      }

      subscriptionPlan = user.subscriptionPlan ?? "FREE";
      manageLandingPagePublishing = resolveManageLandingPagePublishing(subscriptionPlan, user.manageLandingPagePublishing);
      if (user.apiKeys?.[0]) {
        useAi = user.apiKeys[0].useAi;
        aiProvider = user.apiKeys[0].aiProvider;
        aiTier = user.apiKeys[0].aiTier;
        aiAccessMode = user.apiKeys[0].aiAccessMode;
      }

      const activeOrgId = (session.session as { activeOrganizationId?: string } | undefined)?.activeOrganizationId;
      const membership =
        (activeOrgId &&
          (await prisma.member.findUnique({
            where: { organizationId_userId: { organizationId: activeOrgId, userId: session.user.id } },
          }))) ||
        (await prisma.member.findFirst({ where: { userId: session.user.id }, orderBy: { createdAt: "asc" } }));
      if (membership) {
        branding = await resolveSdkBranding(membership.organizationId);
      }
    } else {
      const hashedKey = sha256(rawKey);

      const apiKey = await prisma.apiKey.findFirst({
        where: {
          hashedKey,
          isActive: true,
        },
        select: {
          id: true,
          userId: true,
          organizationId: true,
          useAi: true,
          aiProvider: true,
          aiTier: true,
          aiAccessMode: true,
        },
      });

      if (!apiKey) {
        return NextResponse.json(
          { valid: false, error: "Invalid or inactive API key." },
          { status: 401 }
        );
      }

      // Fetch the owner's subscription plan separately to avoid nested-select type issues
      const user = await (prisma.user.findUnique as any)({
        where: { id: apiKey.userId },
        select: { subscriptionPlan: true, manageLandingPagePublishing: true },
      });

      subscriptionPlan = user?.subscriptionPlan ?? "FREE";
      manageLandingPagePublishing = resolveManageLandingPagePublishing(subscriptionPlan, user?.manageLandingPagePublishing);
      useAi = apiKey.useAi;
      aiProvider = apiKey.aiProvider;
      aiTier = apiKey.aiTier;
      aiAccessMode = apiKey.aiAccessMode;
      branding = await resolveSdkBranding(apiKey.organizationId);

      // Touch lastUsedAt so we can track active SDK sessions
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });
    }

    return NextResponse.json({
      valid: true,
      plan: subscriptionPlan,
      useAi,
      aiProvider,
      aiTier,
      aiAccessMode,
      manageLandingPagePublishing,
      ...(branding ? { branding } : {}),
    });
  } catch (err) {
    console.error("[validate-key] Unexpected error:", err);
    return NextResponse.json(
      { valid: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}
