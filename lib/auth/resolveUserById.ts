import { User } from "@/lib/db/coreEntities";
import { membershipsForUser, ensurePersonalWorkspace } from "@/server/orgMemberships";
import { workspacePlan } from "@/lib/plan/workspacePlan";
import type { OrgRole } from "@/server/accessControl";

export interface LambdaResolvedUser {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  subscriptionPlan: string;
  /** The workspace owner's plan is on its free trial. */
  onTrial: boolean;
  customDomainLimit: number | null;
  manageLandingPagePublishing: boolean;
}

/**
 * The same {userId, organizationId, role, …} shape lib/auth/resolveUser.ts's session branch produces,
 * built from a user id alone — for callers with no browser session (the SOL Lambda's cookie decoding,
 * and WhatsApp, where the phone number IS the credential once linked).
 *
 * `organizationId` is the workspace to act in (the dashboard's active-org cookie, or the one saved when
 * the phone was linked). When it's missing or no longer a membership: a single workspace is used, a
 * brand-new account gets its personal workspace, and several workspaces are ambiguous — `null` for the
 * browser (it can ask the person to choose), or, with `pickWhenAmbiguous`, the one they own first
 * (a chat has no way to ask "which workspace?" before it can do anything).
 */
export async function resolveUserById(
  userId: string,
  opts: { organizationId?: string; pickWhenAmbiguous?: boolean } = {},
): Promise<LambdaResolvedUser | null> {
  const { data: user } = await User.get({ id: userId }).go();
  if (!user) return null;

  const memberships = await membershipsForUser(userId);

  let organizationId: string | null = null;
  let role: OrgRole | null = null;

  const preferred = opts.organizationId ? memberships.find((m) => m.organizationId === opts.organizationId) : undefined;
  if (preferred) {
    organizationId = preferred.organizationId;
    role = preferred.role;
  } else if (memberships.length === 0) {
    const org = await ensurePersonalWorkspace(userId, `${user.name ?? "My"}'s Workspace`);
    organizationId = org.id;
    role = "owner";
  } else if (memberships.length === 1 || opts.pickWhenAmbiguous) {
    const pick = memberships.find((m) => m.role === "owner") ?? memberships[0];
    organizationId = pick.organizationId;
    role = pick.role;
  } else {
    return null;
  }

  // The workspace's plan is its owner's (lib/plan/workspacePlan.ts) — and the effective one,
  // so a lapsed subscription or legacy plan value is read correctly here too.
  const plan = await workspacePlan(organizationId, user, role);
  return { userId: user.id, organizationId, role, ...plan };
}
