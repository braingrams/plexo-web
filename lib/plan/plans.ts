// Plexo's plans, and how plan values stored before the 2026 pricing change are read.
//
// Pure and dependency-free: imported by the entitlement rules, the billing webhooks, the
// migration script, the SOL Lambda bundle and tests alike.
//
// ── The 2026 rename ────────────────────────────────────────────────────────────────────
// Before: FREE → PRO → ULTRA.   Now: FREE → STARTER → PRO → ENTERPRISE.
// Everything the old PRO unlocked is unlocked by STARTER; everything the old ULTRA unlocked
// is unlocked by the new PRO. The awkward part is that "PRO" exists in both worlds with a
// different meaning, so a stored "PRO" can only be read correctly together with the
// account's `planVersion`:
//   • planVersion missing / 1 → written before the change: PRO means STARTER, ULTRA means PRO.
//   • planVersion 2           → written after the change: the value means what it says.
// "ULTRA" only ever existed before the change, so it always means PRO. Every write of a plan
// goes through `planFields()` so it carries planVersion 2 (scripts/billing/migrate-plans.ts
// rewrites the older rows). Stripe subscription metadata follows the same rule with
// metadata.planVersion (see lib/billing/stripePlans.ts).

export const PLAN_IDS = ["FREE", "STARTER", "PRO", "ENTERPRISE"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const PAID_PLAN_IDS = ["STARTER", "PRO", "ENTERPRISE"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

/** Every value the User.subscriptionPlan column may hold, including the retired ULTRA. */
export const STORED_PLAN_VALUES = ["FREE", "STARTER", "PRO", "ULTRA", "ENTERPRISE"] as const;

/** The plan-value meaning written by this code. Rows without it predate the rename. */
export const CURRENT_PLAN_VERSION = 2;

export const PLAN_RANK: Record<PlanId, number> = { FREE: 0, STARTER: 1, PRO: 2, ENTERPRISE: 3 };

export const PLAN_LABELS: Record<PlanId, string> = {
  FREE: "Free",
  STARTER: "Starter",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === "string" && (PAID_PLAN_IDS as readonly string[]).includes(value);
}

/** A plan id in today's terms. ULTRA (retired) reads as PRO; anything unknown is FREE (fail closed). */
export function toPlanId(value: string | null | undefined): PlanId {
  if (value === "ULTRA") return "PRO";
  return isPlanId(value) ? value : "FREE";
}

/** A value stored before the rename, in today's terms: old PRO → STARTER, old ULTRA → PRO. */
export function mapLegacyPlan(value: string | null | undefined): PlanId {
  if (value === "PRO") return "STARTER";
  if (value === "ULTRA") return "PRO";
  return toPlanId(value);
}

/** Reads a stored plan value (subscriptionPlan, pendingPlan, planBeforeDowngrade, Stripe metadata) correctly whatever era wrote it. */
export function normalizeStoredPlan(value: string | null | undefined, planVersion: number | string | null | undefined): PlanId {
  const version = Number(planVersion ?? 0);
  if (!Number.isFinite(version) || version < CURRENT_PLAN_VERSION) return mapLegacyPlan(value);
  return toPlanId(value);
}

/** The fields every write of a plan must set together, so the value is never ambiguous. */
export function planFields(plan: PlanId): { subscriptionPlan: PlanId; planVersion: number } {
  return { subscriptionPlan: plan, planVersion: CURRENT_PLAN_VERSION };
}

/** "Starter", "Pro", … — for any stored or current value (ULTRA reads as Pro). */
export function planLabel(value: string | null | undefined): string {
  return PLAN_LABELS[toPlanId(value)];
}

/** The plan one step up, for "upgrade to …" prompts. Enterprise has none. */
export function nextPlanUp(plan: PlanId): PaidPlanId | null {
  if (plan === "FREE") return "STARTER";
  if (plan === "STARTER") return "PRO";
  if (plan === "PRO") return "ENTERPRISE";
  return null;
}

/** The cheapest plan that turns `predicate` on — "Custom domains are part of Starter". */
export function lowestPlanWhere(predicate: (plan: PlanId) => boolean): PlanId | null {
  return PLAN_IDS.find((p) => predicate(p)) ?? null;
}
