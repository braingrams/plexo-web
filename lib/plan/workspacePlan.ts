// A workspace runs on its OWNER's plan. A teammate acting in someone else's workspace gets
// that workspace's limits — never their own personal plan's (which could be higher or lower).
// Every resolver (resolveUser for the dashboard and API, resolveUserById for SOL/WhatsApp)
// goes through here so the answer is the same everywhere.
//
// No next/headers import — the SOL Lambda bundle uses this too.

import type { EntityItem } from "electrodb";
import { Member, User } from "@/lib/db/coreEntities";
import { resolveManageLandingPagePublishing } from "@/lib/subscription";
import { planEntitlement } from "./entitlement";
import type { PlanId } from "./plans";

type UserItem = EntityItem<typeof User>;

export type WorkspacePlan = {
  subscriptionPlan: PlanId;
  /** The owner's plan is still on its free trial (custom domains, live payments, white-label wait). */
  onTrial: boolean;
  customDomainLimit: number | null;
  manageLandingPagePublishing: boolean;
};

/** The owner's User row for a workspace, or null when it has none (shouldn't happen). */
export async function workspaceOwner(organizationId: string): Promise<UserItem | null> {
  const { data: owners } = await Member.query.primary({ organizationId }).where((attr, op) => op.eq(attr.role, "owner")).go();
  const ownerId = owners[0]?.userId;
  if (!ownerId) return null;
  const { data } = await User.get({ id: ownerId }).go();
  return (data as UserItem | null) ?? null;
}

/** The plan facts that follow from one account (the workspace owner's). */
export function planFromOwner(owner: UserItem | null | undefined): WorkspacePlan {
  const { plan, onTrial } = planEntitlement(owner);
  return {
    subscriptionPlan: plan,
    onTrial,
    customDomainLimit: owner?.customDomainLimit ?? null,
    manageLandingPagePublishing: resolveManageLandingPagePublishing(plan, owner?.manageLandingPagePublishing ?? false),
  };
}

/**
 * The plan for `actingUser` working in `organizationId`. When they own it, their own row is
 * used (no extra read); otherwise the owner's row is loaded.
 */
export async function workspacePlan(organizationId: string, actingUser: UserItem, role: string | null): Promise<WorkspacePlan> {
  if (role === "owner") return planFromOwner(actingUser);
  const owner = await workspaceOwner(organizationId);
  // A workspace with no owner row (data damage) falls back to the person's own plan rather than locking them out.
  if (owner?.id === actingUser.id || !owner) return planFromOwner(actingUser);
  return planFromOwner(owner);
}
