// The monthly budget for SSR builds, in projected dollars. A build can't be priced until it has
// run, so each one reserves a fixed projected cost instead: the most the build function can cost
// in one run. That keeps the budget check synchronous with the upload, and it overstates, which is
// the safe direction for a cap.

/** ProjectBuildFn: 4 GB memory for up to 15 minutes, Lambda x86 at $0.0000166667 per GB-second
 * (us-east-1, verify against current AWS pricing). 4 × 900 × 0.0000166667 ≈ $0.06. */
export const SSR_BUILD_PROJECTED_COST_USD = 0.06;

/** Calendar month in UTC, for example "2026-11". */
export function monthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Pure check: can a build costing `costUsd` run when `usedUsd` has already been projected this month? */
export function fitsBudget(usedUsd: number, budgetUsd: number, costUsd: number = SSR_BUILD_PROJECTED_COST_USD): boolean {
  if (budgetUsd <= 0) return false;
  // Compare in cents so floating-point sums (0.06 + 0.06 + …) can't cross the line by a rounding error.
  return Math.round((usedUsd + costUsd) * 100) <= Math.round(budgetUsd * 100);
}

/**
 * Reserves one SSR build against the organization's monthly budget. Returns the outcome; on success
 * the reservation is already recorded, so call `releaseSsrBuild` if the build never gets queued.
 */
export async function reserveSsrBuild(input: { organizationId: string; budgetUsd: number; now?: Date }): Promise<{ ok: true; usedUsd: number } | { ok: false; usedUsd: number; budgetUsd: number }> {
  const { SsrUsage } = await import("@/lib/db/appEntities");
  const key = { organizationId: input.organizationId, month: monthKey(input.now) };
  // Make sure the month's row exists; a conflict just means another request created it first.
  await SsrUsage.create({ ...key, projectedCostUsd: 0, buildCount: 0 }).go().catch(() => undefined);
  const { data: current } = await SsrUsage.get(key).go();
  const usedUsd = current?.projectedCostUsd ?? 0;
  if (!fitsBudget(usedUsd, input.budgetUsd)) return { ok: false, usedUsd, budgetUsd: input.budgetUsd };
  try {
    // Conditional add: if another build used the last of the budget in the meantime, this fails.
    const limitBeforeThisBuild = Math.round((input.budgetUsd - SSR_BUILD_PROJECTED_COST_USD) * 100) / 100;
    await SsrUsage.patch(key)
      .add({ projectedCostUsd: SSR_BUILD_PROJECTED_COST_USD, buildCount: 1 })
      .where((attr, op) => op.lte(attr.projectedCostUsd, limitBeforeThisBuild))
      .go();
  } catch {
    const { data: after } = await SsrUsage.get(key).go();
    return { ok: false, usedUsd: after?.projectedCostUsd ?? usedUsd, budgetUsd: input.budgetUsd };
  }
  return { ok: true, usedUsd: usedUsd + SSR_BUILD_PROJECTED_COST_USD };
}

/** Gives back one reservation, for a build that was reserved but never queued. */
export async function releaseSsrBuild(input: { organizationId: string; now?: Date }): Promise<void> {
  const { SsrUsage } = await import("@/lib/db/appEntities");
  const key = { organizationId: input.organizationId, month: monthKey(input.now) };
  await SsrUsage.patch(key).add({ projectedCostUsd: -SSR_BUILD_PROJECTED_COST_USD, buildCount: -1 }).go().catch(() => undefined);
}
