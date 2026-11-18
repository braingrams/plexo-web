/**
 * The 2026 plan move (lib/billing/planMigration.ts): old Pro → Starter, old Ultra → Pro.
 * Rewrites every unmigrated User row (planVersion 2) and books each live Stripe plan
 * subscription onto the new plan's price from its next renewal (a subscription schedule — no
 * charge today, no proration). Safe to re-run: finished accounts are skipped.
 *
 *   npx tsx scripts/billing/migrate-plans.ts                    # DRY RUN (default): prints what it would do, writes nothing, calls nothing that changes Stripe
 *   npx tsx scripts/billing/migrate-plans.ts --apply            # writes User rows + creates Stripe prices/schedules
 *   npx tsx scripts/billing/migrate-plans.ts --apply --notify   # …and emails each paying owner once
 *   add --only=<email> to run for one account first.
 *
 * Needs the target environment's AWS credentials / PLEXO_*_TABLE env, and STRIPE_SECRET_KEY
 * (without it, only User rows are handled and subscriptions are reported as skipped).
 * Run AFTER the new code is deployed (the code reads unmigrated rows correctly meanwhile).
 */
import "dotenv/config";

import { User } from "../../lib/db/coreEntities";
import { getStripe } from "../../lib/stripe";
import { loadPriceBook } from "../../lib/billing/priceBook";
import { ensureStripePlanPrice } from "../../lib/billing/stripePrices";
import { runPlanMigration, type LegacyUser } from "../../lib/billing/planMigration";
import { buildPlanMoveEmail } from "../../lib/mail/templates";
import { sendMaildripEmail } from "../../lib/mail/maildrip";

const apply = process.argv.includes("--apply");
const notify = process.argv.includes("--notify");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length).toLowerCase();

async function* listUsers(): AsyncIterable<LegacyUser> {
  let cursor: string | null = null;
  do {
    const page: { data: LegacyUser[]; cursor: string | null } = await User.scan.go({ cursor });
    for (const u of page.data) if (!only || u.email.toLowerCase() === only) yield u;
    cursor = page.cursor;
  } while (cursor);
}

async function main() {
  console.log(apply ? `APPLYING${notify ? " + emailing owners" : ""}` : "DRY RUN — nothing is written (pass --apply to write)");
  const stripe = process.env.STRIPE_SECRET_KEY ? getStripe() : null;
  if (!stripe) console.log("STRIPE_SECRET_KEY not set — subscriptions won't be scheduled.");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://plexo.charisol.io";
  const report = await runPlanMigration({
    apply,
    notify,
    book: await loadPriceBook({ fresh: true }),
    listUsers,
    stripe,
    ensurePrice: (group, plan, interval) => ensureStripePlanPrice(stripe!, group, plan, interval),
    patchUser: async (id, fields, onlyIfUnmigrated) => {
      try {
        await User.patch({ id })
          .set(fields as never)
          .where((attr, op) => (onlyIfUnmigrated ? `${op.notExists(attr.planVersion)} OR ${op.lt(attr.planVersion, 2)}` : ""))
          .go();
        return true;
      } catch (err) {
        if ((err as { name?: string; cause?: { name?: string } })?.cause?.name === "ConditionalCheckFailedException") return false;
        throw err;
      }
    },
    sendEmail: async (user, input) => {
      const { subject, html } = buildPlanMoveEmail({ ...input, manageUrl: `${appUrl}/dashboard/settings/subscription` });
      await sendMaildripEmail({ to: user.email, subject, html });
    },
    log: (line) => console.log(line),
  });
  console.log("\nDone:", JSON.stringify(report));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
