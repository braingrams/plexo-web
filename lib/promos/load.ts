// Reads the promo list plexo-admin edits. One small query, kept ~60s in memory (like the price
// book), and FAIL CLOSED: any error means "no banner" — a promo must never slow or break a page.

import { Promo } from "@/lib/db/coreEntities";
import { validatePromo, type PromoRecord } from "./promos";

export const PROMOS_TTL_MS = 60_000;
let cache: { at: number; promos: PromoRecord[] } | null = null;

export async function loadPromos(): Promise<PromoRecord[]> {
  if (cache && Date.now() - cache.at < PROMOS_TTL_MS) return cache.promos;
  try {
    const { data } = await Promo.query.primary({}).go({ limit: 50 });
    const promos = (data as PromoRecord[]).filter((p) => validatePromo(p).length === 0);
    cache = { at: Date.now(), promos };
    return promos;
  } catch (err) {
    console.error("[promos] couldn't load — showing no banner", err);
    cache = { at: Date.now() - PROMOS_TTL_MS + 10_000, promos: [] }; // retry soon, don't hammer
    return [];
  }
}

export function invalidatePromoCache(): void {
  cache = null;
}
