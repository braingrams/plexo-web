import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { ApiKey, User } from "@/lib/db/coreEntities";
import { resolveManageLandingPagePublishing } from "@/lib/subscription";
import type { OrgRole } from "@/server/accessControl";

// DynamoDB-native replacement for app/api/v1/domains/route.ts's resolveUser — moved to a
// proper shared home since it's imported by 29 files across the public API surface, not
// just the domains route it happened to live in under the Prisma stack.
//
// The original's session-branch read session.session.activeOrganizationId directly;
// this uses ensureActiveOrganization (server/orgDynamo.ts) instead, which also handles
// the "brand new user, no membership yet" and "several orgs, none active" cases the same
// way the dashboard layout does — a caller hitting a v1 API route right after signup
// shouldn't get a different answer than the dashboard would.
//
// Drops the original's `OR: [{hashedKey}, {maskedKey: rawKey}]` — maskedKey is a display
// value (`${rawKey.slice(0,10)}...${rawKey.slice(-4)}`), never equal to a real raw key for
// any actual client, so that branch could never match in practice. Only hashedKey (now
// GSI2-indexed, see coreEntities.ts's byHashedKey) is a real lookup.

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
}

export async function resolveUser(
  request: NextRequest,
): Promise<{
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  subscriptionPlan: string;
  customDomainLimit: number | null;
  manageLandingPagePublishing: boolean;
} | null> {
  // 1. Try session-based auth first
  const session = await auth();
  if (session?.user) {
    const { data: user } = await User.get({ id: session.user.id }).go();
    if (user) {
      const orgResolution = await ensureActiveOrganization(session.user.id);
      if (orgResolution.status === "needs-choice") return null;

      return {
        userId: user.id,
        organizationId: orgResolution.organizationId,
        role: orgResolution.role,
        subscriptionPlan: user.subscriptionPlan ?? "FREE",
        customDomainLimit: user.customDomainLimit ?? null,
        manageLandingPagePublishing: resolveManageLandingPagePublishing(
          user.subscriptionPlan ?? "FREE",
          user.manageLandingPagePublishing ?? false,
        ),
      };
    }
  }

  // 2. Try x-api-key header
  let rawKey = request.headers.get("x-api-key")?.trim() || null;
  if (!rawKey) {
    // 3. Try Bearer token
    rawKey = parseBearerToken(request.headers.get("authorization"));
  }

  if (rawKey === "workspace-internal") {
    return null;
  }

  if (!rawKey) return null;

  const hashedKey = sha256(rawKey);
  const { data: matches } = await ApiKey.query.byHashedKey({ hashedKey }).go();
  const apiKey = matches.find((k) => k.isActive);
  if (!apiKey) return null;

  const { data: user } = await User.get({ id: apiKey.userId }).go();
  if (!user) return null;

  return {
    userId: apiKey.userId,
    organizationId: apiKey.organizationId,
    role: null,
    subscriptionPlan: user.subscriptionPlan ?? "FREE",
    customDomainLimit: user.customDomainLimit ?? null,
    manageLandingPagePublishing: resolveManageLandingPagePublishing(
      user.subscriptionPlan ?? "FREE",
      user.manageLandingPagePublishing ?? false,
    ),
  };
}
