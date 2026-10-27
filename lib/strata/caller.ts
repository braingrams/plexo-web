import type { NextRequest } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getCharisolPartnerVerifier } from "@/server/charisolVerifier";
import { resolveCharisolUser } from "@/server/charisolAccount";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { User } from "@/lib/db/coreEntities";
import { effectivePlan } from "@/lib/plan/entitlement";
import { resolveManageLandingPagePublishing } from "@/lib/subscription";

type Resolved = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/**
 * Who is calling a Strata-facing route. Strata sends the person's own Charisol sign-in
 * (Authorization: Bearer <Charisol ID token>) — one account across Charisol products, nothing
 * extra to paste. A Plexo session or API key works too. The Charisol token is verified (signature,
 * pool, and that it was issued to Plexo or a trusted partner client) and matched to the Plexo
 * account by email exactly like signing in to Plexo; first-time people get an account made.
 * Returns null for anything unverifiable, unverified-email or suspended.
 */
export async function resolveStrataCaller(request: NextRequest): Promise<Resolved | null> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer && JWT.test(bearer)) {
    let claims: Record<string, unknown>;
    try {
      claims = (await getCharisolPartnerVerifier().verify(bearer)) as unknown as Record<string, unknown>;
    } catch {
      return null;
    }
    const local = await resolveCharisolUser(claims).catch(() => null);
    if (!local) return null;
    const { data: user } = await User.get({ id: local.id }).go();
    if (!user || user.suspendedAt) return null;
    const org = await ensureActiveOrganization(local.id);
    // Several workspaces and no active one (there's no browser here): use the one they own, else the first.
    const pick = org.status === "resolved" ? { organizationId: org.organizationId, role: org.role } : (() => {
      const o = org.organizations.find((x) => x.role === "owner") ?? org.organizations[0];
      return o ? { organizationId: o.id, role: o.role } : null;
    })();
    if (!pick) return null;
    return {
      userId: user.id,
      organizationId: pick.organizationId,
      role: pick.role,
      subscriptionPlan: effectivePlan(user),
      customDomainLimit: user.customDomainLimit ?? null,
      manageLandingPagePublishing: resolveManageLandingPagePublishing(effectivePlan(user), user.manageLandingPagePublishing ?? false),
    };
  }
  return resolveUser(request);
}
