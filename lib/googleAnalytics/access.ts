import { PLAN, PLAN_RANK, toPlanId } from "@/lib/plan/plans";

/**
 * Google Analytics (Plexo-managed or the owner's own account) is a paid-plan feature: Starter and above,
 * a free trial included. Free sites keep Plexo's own simple visit counts. Every route and tool that touches
 * Google asks here; the page and the dashboard only mirror the answer.
 */
export function canUseGoogleAnalytics(plan: string | null | undefined): boolean {
  return PLAN_RANK[toPlanId(plan)] >= PLAN_RANK[PLAN.STARTER];
}

/** Said to the owner (and to an AI assistant acting for them) when the plan does not include Google Analytics. */
export const ANALYTICS_UPGRADE_MESSAGE =
  "Detailed visitor numbers from Google Analytics come with a paid plan (Starter and above). Your simple visit counts stay free. Upgrade in Billing to switch it on. Nothing is lost if you upgrade later.";
