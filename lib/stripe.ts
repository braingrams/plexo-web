import Stripe from "stripe";

let client: Stripe | null = null;

/** Lazily-constructed singleton Stripe client — avoids failing at module load/build time. */
export function getStripe(): Stripe {
  if (client) return client;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  client = new Stripe(secretKey, {
    apiVersion: "2026-06-24.dahlia",
  });
  return client;
}
