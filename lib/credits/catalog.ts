/**
 * Maps a plan/pack name the client can request to the env var holding its
 * actual Stripe Price ID. The client never sends a raw price ID directly —
 * that would let it pick arbitrary Stripe prices; it can only name one of
 * these known keys, and the server resolves the real price server-side.
 */
export const PLAN_PRICE_ENV: Record<"PRO" | "ULTRA", string> = {
  PRO: "STRIPE_PRICE_PRO",
  ULTRA: "STRIPE_PRICE_ULTRA",
};

export interface TopupPack {
  priceEnv: string;
}

/**
 * Credit packs. Their credits aren't fixed here: a pack grants half of what it costs as AI
 * value (lib/credits/value.ts — creditsForTopupPayment), so changing a pack's price in Stripe
 * changes its credits too. See topupOffer() for the amount shown before buying, and the Stripe
 * webhook for the amount granted (from what was actually paid).
 */
export const TOPUP_PACKS: Record<"SMALL" | "MEDIUM" | "LARGE", TopupPack> = {
  SMALL: { priceEnv: "STRIPE_PRICE_TOPUP_SMALL" },
  MEDIUM: { priceEnv: "STRIPE_PRICE_TOPUP_MEDIUM" },
  LARGE: { priceEnv: "STRIPE_PRICE_TOPUP_LARGE" },
};

export function resolvePriceId(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(`${envVar} is not configured.`);
  }
  return value;
}
