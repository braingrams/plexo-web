/**
 * One-off: imports Plexo's historical Stripe charges into the Payment table (lib/billing/
 * payments.ts), so every past payment has a receipt and shows in the owner's history and the
 * admin console. Also fills each user's card-on-file snapshot and current-subscription period.
 *
 * Safe to re-run — a charge already recorded is just updated. Never emails anyone.
 *
 *   npx tsx scripts/backfill-payments.ts            # dry run: prints what it would do
 *   npx tsx scripts/backfill-payments.ts --apply    # writes
 *
 * Needs STRIPE_SECRET_KEY plus the usual AWS credentials / PLEXO_*_TABLE env for the target
 * environment.
 */
import "dotenv/config";

import { getStripe } from "../lib/stripe";
import { User } from "../lib/db/coreEntities";
import { Payment } from "../lib/db/ledgerEntities";
import { recordStripeCharge } from "../lib/billing/payments";

const apply = process.argv.includes("--apply");

async function main() {
  const stripe = getStripe();
  console.log(apply ? "APPLYING — writing to the Payment table" : "DRY RUN — nothing is written (pass --apply to write)");

  const latestCard = new Map<string, { brand?: string; last4: string; expMonth?: number; expYear?: number }>();
  let seen = 0;
  let recorded = 0;
  let skipped = 0;

  for await (const charge of stripe.charges.list({ limit: 100 })) {
    seen++;
    if (!apply) {
      const { data } = await Payment.get({ id: charge.id }).go();
      if (!data) recorded++;
      continue;
    }
    const result = await recordStripeCharge(stripe, charge, { updateUserCard: false });
    if (!result) {
      skipped++;
      continue;
    }
    recorded++;
    // Charges list newest first, so the first paid card seen per user is their latest.
    const p = result.payment;
    if (result.payment.status === "PAID" && p.cardLast4 && !latestCard.has(p.userId)) {
      latestCard.set(p.userId, { brand: p.cardBrand, last4: p.cardLast4, expMonth: p.cardExpMonth, expYear: p.cardExpYear });
    }
    if (seen % 50 === 0) console.log(`  …${seen} charges`);
  }

  if (apply) {
    for (const [userId, card] of latestCard) {
      await User.patch({ id: userId }).set({ billingCardBrand: card.brand, billingCardLast4: card.last4, billingCardExpMonth: card.expMonth, billingCardExpYear: card.expYear }).go();
    }
    for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
      const userId = sub.metadata?.plexoUserId;
      if (!userId || sub.metadata?.kind === "lms_addon_slot") continue;
      const { data: user } = await User.get({ id: userId }).go();
      if (!user || user.stripeSubscriptionId !== sub.id) continue; // only the account's current plan subscription
      const end = sub.items.data[0]?.current_period_end;
      await User.patch({ id: userId })
        .set({ subscriptionStartedAt: new Date(sub.start_date * 1000).toISOString(), subscriptionCancelAtPeriodEnd: sub.cancel_at_period_end, ...(end ? { subscriptionPeriodEnd: new Date(end * 1000).toISOString() } : {}) })
        .go();
    }
  }

  console.log(`${seen} charges in Stripe · ${apply ? `${recorded} recorded/updated, ${skipped} not tied to a Plexo account` : `${recorded} not yet recorded`}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
