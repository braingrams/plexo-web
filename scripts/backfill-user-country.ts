/**
 * One-off: suggests a country for EXISTING accounts that never chose one, so fewer people
 * hit the "Where are you based?" prompt and regional prices already match where they live.
 *
 *   npx tsx scripts/backfill-user-country.ts            # dry run: prints what it would set
 *   npx tsx scripts/backfill-user-country.ts --apply    # writes country (+ countrySetAt)
 *
 * Evidence, strongest first: the country saved at their first checkout (billingCountry), then
 * the currency of a payment (NGN -> Nigeria, GHS -> Ghana, KES -> Kenya, ZAR -> South Africa;
 * USD says nothing, so it's skipped). NEVER overwrites a country someone already set: the
 * write is conditional on the field being absent. Accounts with no evidence are left for the
 * dashboard prompt. Needs AWS credentials and the PLEXO_*_TABLE vars for the target environment.
 */
import "dotenv/config";

import { User } from "../lib/db/coreEntities";
import { Payment } from "../lib/db/ledgerEntities";
import { normalizeCountryCode } from "../lib/countries";

const apply = process.argv.includes("--apply");
const CURRENCY_COUNTRY: Record<string, string> = { NGN: "NG", GHS: "GH", KES: "KE", ZAR: "ZA" };

async function paymentCountry(userId: string): Promise<string | null> {
  const { data } = await Payment.query.byUser({ userId }).go({ limit: 25 });
  const votes = new Map<string, number>();
  for (const p of data) {
    const c = CURRENCY_COUNTRY[p.currency.toUpperCase()];
    if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function main(): Promise<void> {
  const { data: users } = await User.scan.go({ pages: "all" });
  const stats = { already: 0, fromBilling: 0, fromPayments: 0, none: 0, written: 0 };
  for (const u of users) {
    if (normalizeCountryCode(u.country)) {
      stats.already++;
      continue;
    }
    let country = normalizeCountryCode(u.billingCountry);
    let how = "billingCountry";
    if (country) stats.fromBilling++;
    else {
      country = await paymentCountry(u.id).catch(() => null);
      how = "payment currency";
      if (country) stats.fromPayments++;
    }
    if (!country) {
      stats.none++;
      continue;
    }
    console.log(`${apply ? "set" : "would set"} ${u.email} -> ${country} (${how})`);
    if (apply) {
      try {
        await User.patch({ id: u.id })
          .set({ country, countrySetAt: new Date().toISOString() })
          .where((a, { notExists }) => notExists(a.country))
          .go();
        stats.written++;
      } catch (err) {
        if ((err as { code?: number; name?: string }).name !== "ConditionalCheckFailedException") console.error(`failed for ${u.email}:`, err);
      }
    }
  }
  console.log(`\n${users.length} accounts: ${stats.already} already have a country, ${stats.fromBilling} from billing country, ${stats.fromPayments} from payments, ${stats.none} no evidence (will be asked).`);
  console.log(apply ? `Wrote ${stats.written}.` : "Dry run: nothing written. Re-run with --apply.");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
