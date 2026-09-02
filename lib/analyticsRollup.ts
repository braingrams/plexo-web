import { PageViewDailyStat } from "@/lib/db/opsEntities";

/**
 * Atomically increments the small, fixed set of platform-wide rollup counters a single
 * page view feeds — see PageViewDailyStat's comment in lib/db/opsEntities.ts for why this
 * exists (replaces plexo-admin's Overview dashboard scanning every raw PageView row).
 * Fire-and-forget from the caller, same as the PageView.create() call it accompanies —
 * a lost rollup increment (rare, only on a genuine write failure) undercounts a chart by
 * one, not a correctness issue worth blocking the response for.
 *
 * `.add()` on a (date, dimension) pair that doesn't exist yet still works — DynamoDB's
 * underlying UpdateItem creates the item and treats the missing numeric attribute as 0
 * before adding, no separate create-then-patch dance needed (unlike this migration's
 * balance-mutation code, which needs optimistic locking for business-logic reasons this
 * plain counter doesn't have). Must be `.update()`, not `.patch()` — confirmed by reading
 * node_modules/electrodb/src/clauses.js directly: `.patch()` unconditionally adds an
 * `attribute_exists(pk)` filter, so it can only ever modify a row that's already there;
 * `.update()` has no such condition and is the one that actually upserts. Using `.patch()`
 * here (the original version of this file) meant every first-ever hit of a given (date,
 * dimension) pair threw ConditionalCheckFailedException — silently, since this whole call
 * is fire-and-forget — undercounting every chart from the moment this rollup went live.
 */
export async function recordPageViewRollup(input: {
  createdAt: Date;
  templateId: string;
  deviceType?: string | null;
  browser?: string | null;
  os?: string | null;
}): Promise<void> {
  const date = input.createdAt.toISOString().slice(0, 10);
  const hour = input.createdAt.getUTCHours();

  const dimensions = [
    "TOTAL",
    `HOUR#${hour}`,
    `DEVICE#${input.deviceType || "Unknown"}`,
    `BROWSER#${input.browser || "Unknown"}`,
    `OS#${input.os || "Unknown"}`,
    `SITE#${input.templateId}`,
  ];

  await Promise.all(
    dimensions.map((dimension) => PageViewDailyStat.update({ date, dimension }).add({ views: 1 }).go()),
  );
}
