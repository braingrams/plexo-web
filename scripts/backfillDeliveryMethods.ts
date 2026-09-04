/**
 * One-off (but safely re-runnable) catch-up for the real delivery-methods system: every
 * Commerce-enabled site that predates it has zero CommerceDeliveryMethod rows, which would
 * make its storefront checkout show "No delivery methods available" and block PHYSICAL-item
 * checkout entirely the moment this ships (see lib/commerce/delivery.ts /
 * app/api/public/commerce/delivery-methods/route.ts). This seeds two rows — Pickup (free)
 * and Courier — reproducing exactly what checkout used to hardcode everywhere
 * (COURIER_FEE_MINOR = 150000, i.e. NGN 1,500, now removed from public/commerce.js and both
 * checkout routes) so no live site's checkout silently loses delivery options or changes
 * price the moment this deploys. Both seeded rows are worldwide (empty countries/states —
 * see isMethodApplicable's "empty = unrestricted" rule), matching the old hardcoded options'
 * behavior of being available to every visitor regardless of address.
 *
 * Idempotent by construction: a site is only ever seeded when it currently has zero
 * CommerceDeliveryMethod rows, so re-running after a partial failure, or once new sites with
 * their own real methods have accumulated, never double-seeds anything.
 *
 * Usage: tsx scripts/backfillDeliveryMethods.ts [--dry-run]
 */
import { randomUUID } from "node:crypto";
import { CommerceSettings, CommerceDeliveryMethod } from "@/lib/db/commerceEntities";

const COURIER_FEE_MINOR = 150000;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  // No GSI lists "every enabled site" directly (both of CommerceOrder's existing GSIs are
  // already spoken for — see the plan's explicit "no new GSIs" constraint) — ElectroDB's
  // own `.scan` handles the entity-type filter and pagination for us, unlike a raw
  // docClient.scan. Fine at this scale (single low-thousands-row table, one-off script).
  const { data: enabledSites } = await CommerceSettings.scan.where(({ enabled }, { eq }) => eq(enabled, true)).go({ pages: "all" });

  console.log(`Found ${enabledSites.length} Commerce-enabled site(s)${dryRun ? " (dry run)" : ""}`);

  let seeded = 0;
  let skipped = 0;
  for (const settings of enabledSites) {
    const { templateId, organizationId } = settings;
    const { data: existing } = await CommerceDeliveryMethod.query.primary({ templateId }).go();
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    console.log(`- ${templateId}: seeding default Pickup + Courier delivery methods`);
    if (dryRun) {
      seeded++;
      continue;
    }

    try {
      await CommerceDeliveryMethod.put([
        {
          id: randomUUID(),
          templateId,
          organizationId,
          name: "Pickup",
          type: "PICKUP",
          feeMinor: 0,
          sortOrder: 0,
        },
        {
          id: randomUUID(),
          templateId,
          organizationId,
          name: "Courier delivery",
          type: "COURIER",
          feeMinor: COURIER_FEE_MINOR,
          sortOrder: 1,
        },
      ]).go();
      seeded++;
    } catch (err) {
      console.error(`  FAILED for ${templateId}:`, err);
    }
  }

  console.log(`Done. Seeded ${seeded} site(s), skipped ${skipped} (already had delivery methods configured).`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
