// Server-side rules for the owner's own country: saving it, and when to ask for it.

import { User } from "@/lib/db/coreEntities";
import { hasRunningSubscription } from "@/lib/billing/region";
import { normalizeCountryCode } from "@/lib/countries";

export { shouldAskCountry } from "@/lib/countries";

type SaveUser = Parameters<typeof hasRunningSubscription>[0] & { id: string; country?: string | null };

/**
 * Saves the owner's country. It changes the price list for FUTURE billing: with no running
 * plan the saved price choice is reset (it's set again at their next checkout); a running plan
 * keeps its currency until it ends (lib/billing/region.ts).
 */
export async function saveUserCountry(user: SaveUser, input: unknown, now = new Date()): Promise<{ ok: true; country: string } | { ok: false; error: string }> {
  const country = normalizeCountryCode(input);
  if (!country) return { ok: false, error: "Choose a country from the list." };
  if (user.country === country) return { ok: true, country };
  let patch = User.patch({ id: user.id }).set({ country, countrySetAt: now.toISOString() });
  if (!hasRunningSubscription(user)) patch = patch.remove(["billingCountry", "billingCurrency", "billingRegion", "billingRegionLockedAt"]);
  await patch.go();
  return { ok: true, country };
}
