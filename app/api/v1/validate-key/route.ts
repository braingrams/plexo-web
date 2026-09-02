import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { ApiKey, Member, Organization, User } from "@/lib/db/coreEntities";
import { resolveManageLandingPagePublishing, canWhiteLabel } from "@/lib/subscription";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Resolved only when the org is entitled (Pro/Ultra owner plan) and has actually set
 * branding — otherwise omitted from the response entirely, so a Free-tier embed (or one
 * from an org that hasn't configured anything) keeps plexo-sdk's default Plexo splash.
 * See plexo-sdk's useApiKeyValidation.ts, which consumes this field.
 *
 * DynamoDB-native replacement for lib/subscription.ts's getOrganizationOwnerPlan/getOrgBrand
 * (both still Prisma-backed and out of this file's scope) — reimplemented directly against
 * Member/User/Organization since it's a small, local, self-contained lookup, using the same
 * "find the owner member, read their plan" join server/orgDynamo.ts already does elsewhere.
 */
async function resolveSdkBranding(
  organizationId: string,
): Promise<{ name: string; logoUrl?: string; brandColor?: string } | undefined> {
  const { data: owners } = await Member.query.primary({ organizationId }).where((attr, op) => op.eq(attr.role, "owner")).go();
  const owner = owners[0];
  if (!owner) return undefined;

  const { data: ownerUser } = await User.get({ id: owner.userId }).go();
  const plan = ownerUser?.subscriptionPlan ?? "FREE";
  if (!canWhiteLabel(plan)) return undefined;

  const { data: org } = await Organization.get({ id: organizationId }).go();
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
 *   Deliberately does NOT return a canvasFidelity field -- that used to gate the compiled
 *   canvas behind an app-specific allowlist, a leftover from canary-rollout scaffolding built
 *   before the SDK's own default ('auto') resolved to 'compiled' unconditionally. plexo-sdk's
 *   useApiKeyValidation.ts already treats a missing/absent canvasFidelity as "no override" and
 *   falls through to that SDK-level default -- so omitting the field entirely is exactly what
 *   a normal SDK integration (one that's never heard of this endpoint's history) looks like,
 *   not a special case this app has to maintain forever.
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
      const session = await auth();

      if (!session?.user) {
        return NextResponse.json(
          { valid: false, error: "Unauthorized: No active session found." },
          { status: 401 }
        );
      }

      const { data: user } = await User.get({ id: session.user.id }).go();

      if (!user) {
        return NextResponse.json(
          { valid: false, error: "Authenticated user not found." },
          { status: 401 }
        );
      }

      subscriptionPlan = user.subscriptionPlan ?? "FREE";
      manageLandingPagePublishing = resolveManageLandingPagePublishing(subscriptionPlan, user.manageLandingPagePublishing ?? false);

      // ApiKey has no createdAt-sorted index for "this user's keys" (byUser's SK is `id`,
      // not createdAt) — sort the (small) result set in memory, same pattern as
      // app/api/v1/ai/generate/route.ts's own workspace-internal resolution.
      const { data: keys } = await ApiKey.query.byUser({ userId: session.user.id }).go();
      const activeKey = keys
        .filter((k) => k.isActive)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
      if (activeKey) {
        useAi = activeKey.useAi ?? false;
        aiProvider = activeKey.aiProvider ?? "openai";
        aiTier = activeKey.aiTier ?? "AUTO";
        aiAccessMode = activeKey.aiAccessMode ?? "SYSTEM";
      }

      const orgResolution = await ensureActiveOrganization(session.user.id);
      if (orgResolution.status === "resolved") {
        branding = await resolveSdkBranding(orgResolution.organizationId);
      }
    } else {
      const hashedKey = sha256(rawKey);

      const { data: matches } = await ApiKey.query.byHashedKey({ hashedKey }).go();
      const apiKey = matches.find((k) => k.isActive);

      if (!apiKey) {
        return NextResponse.json(
          { valid: false, error: "Invalid or inactive API key." },
          { status: 401 }
        );
      }

      const { data: user } = await User.get({ id: apiKey.userId }).go();

      subscriptionPlan = user?.subscriptionPlan ?? "FREE";
      manageLandingPagePublishing = resolveManageLandingPagePublishing(subscriptionPlan, user?.manageLandingPagePublishing ?? false);
      useAi = apiKey.useAi ?? false;
      aiProvider = apiKey.aiProvider ?? "openai";
      aiTier = apiKey.aiTier ?? "AUTO";
      aiAccessMode = apiKey.aiAccessMode ?? "SYSTEM";
      branding = await resolveSdkBranding(apiKey.organizationId);

      // Touch lastUsedAt so we can track active SDK sessions
      await ApiKey.patch({ organizationId: apiKey.organizationId, id: apiKey.id })
        .set({ lastUsedAt: new Date().toISOString() })
        .go();
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
