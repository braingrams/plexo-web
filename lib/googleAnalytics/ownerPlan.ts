import { workspaceOwner } from "@/lib/plan/workspacePlan";
import { planEntitlement } from "@/lib/plan/entitlement";
import { canUseGoogleAnalytics } from "./access";

/**
 * Is the workspace that owns this site on a paid plan right now? Used where only an organization id is known
 * (serving a page, the nightly sweep).
 */
export async function organizationHasAnalyticsPlan(organizationId: string): Promise<boolean> {
  const owner = await workspaceOwner(organizationId);
  if (!owner) return false;
  return canUseGoogleAnalytics(planEntitlement(owner).plan);
}
