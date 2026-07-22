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
  credits: number;
  label: string;
}

export const TOPUP_PACKS: Record<"SMALL" | "MEDIUM" | "LARGE", TopupPack> = {
  SMALL: { priceEnv: "STRIPE_PRICE_TOPUP_SMALL", credits: 5_000, label: "5,000 credits" },
  MEDIUM: { priceEnv: "STRIPE_PRICE_TOPUP_MEDIUM", credits: 25_000, label: "25,000 credits" },
  LARGE: { priceEnv: "STRIPE_PRICE_TOPUP_LARGE", credits: 120_000, label: "120,000 credits" },
};

export function resolvePriceId(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(`${envVar} is not configured.`);
  }
  return value;
}
