// "Which plan lifts this limit?" — the cheapest paid plan whose allowance beats what the
// account already has. Server-side only (reads the entitlement table); the answer travels to
// the dashboard as `requiredPlan` on the plan-gate error body (lib/plan/planGate.ts), so a
// limit never sends the owner to a plan that wouldn't actually help (e.g. Starter→Starter).

import { getTierFeatures, type TierFeatures } from "@/lib/subscription";
import { PAID_PLAN_IDS, PLAN, type PaidPlanId } from "./plans";

/** The first paid plan whose `pick` value is higher than `current` (null = unlimited counts as highest). Falls back to Pro. */
export function planThatRaises(pick: (f: TierFeatures) => number | null, current: number | null): PaidPlanId {
  if (current === null) return PLAN.PRO;
  const found = PAID_PLAN_IDS.find((p) => {
    const v = pick(getTierFeatures(p));
    return v === null || v > current;
  });
  return found ?? PLAN.PRO;
}

/** The first paid plan where a yes/no feature is on. */
export function planThatEnables(pick: (f: TierFeatures) => boolean): PaidPlanId {
  return PAID_PLAN_IDS.find((p) => pick(getTierFeatures(p))) ?? PLAN.PRO;
}
