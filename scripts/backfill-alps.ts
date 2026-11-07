/**
 * One-off: pushes every existing Plexo user into Alps, so the CRM starts complete rather than
 * only knowing people who sign up from now on. Safe to re-run — Alps upserts on the Plexo user
 * id, and each user's idempotency key is fixed, so nobody is ever duplicated.
 *
 *   npx tsx scripts/backfill-alps.ts            # dry run: prints how many users it would send
 *   npx tsx scripts/backfill-alps.ts --apply    # sends them
 *
 * Needs ALPS_API_KEY plus the usual AWS credentials / PLEXO_*_TABLE env for the target
 * environment. Uses one request per user (paced under Alps' 100 requests / 10 s limit) because
 * the batch endpoint can't carry per-contact idempotency keys.
 */
import "dotenv/config";

import { User } from "../lib/db/coreEntities";
import { syncContactToAlps } from "../lib/alps";

const apply = process.argv.includes("--apply");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (apply && !process.env.ALPS_API_KEY) throw new Error("Set ALPS_API_KEY first.");
  console.log(apply ? "APPLYING — sending users to Alps" : "DRY RUN — nothing is sent (pass --apply to send)");

  const { data: users } = await User.scan.go({ pages: "all" });
  let sent = 0;
  let failed = 0;
  for (const user of users) {
    if (!user.email || user.suspendedAt) continue;
    if (!apply) {
      sent++;
      continue;
    }
    try {
      await syncContactToAlps(
        { id: user.id, email: user.email, name: user.name, image: user.image },
        {
          idempotencyKey: `backfill-${user.id}`,
          customProperties: { plexoPlan: user.subscriptionPlan ?? "FREE", plexoSignedUpAt: user.createdAt },
        },
      );
      sent++;
    } catch (err) {
      failed++;
      console.error(`  ${user.email}:`, err instanceof Error ? err.message : err);
    }
    await sleep(150);
  }
  console.log(`${apply ? "Sent" : "Would send"} ${sent} user(s)${failed ? `, ${failed} failed` : ""}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
