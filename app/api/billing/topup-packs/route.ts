import { NextResponse } from "next/server";
import { TOPUP_PACKS, resolvePriceId } from "@/lib/credits/catalog";
import { getStripe } from "@/lib/stripe";
import { auth } from "@/server/authDynamo";

type Pack = { pack: keyof typeof TOPUP_PACKS; credits: number; price: string | null };

// Prices change rarely; one Stripe lookup per pack per instance per 10 minutes.
let cache: { at: number; packs: Pack[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

function formatPrice(amount: number | null | undefined, currency: string): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100);
}

/** GET /api/billing/topup-packs → the credit packs with their real prices, for top-up pickers. */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json({ packs: cache.packs });
  const stripe = getStripe();
  const packs = await Promise.all(
    (Object.keys(TOPUP_PACKS) as Array<keyof typeof TOPUP_PACKS>).map(async (pack): Promise<Pack> => {
      try {
        const price = await stripe.prices.retrieve(resolvePriceId(TOPUP_PACKS[pack].priceEnv));
        return { pack, credits: TOPUP_PACKS[pack].credits, price: formatPrice(price.unit_amount, price.currency) };
      } catch {
        return { pack, credits: TOPUP_PACKS[pack].credits, price: null };
      }
    }),
  );
  if (packs.every((p) => p.price)) cache = { at: Date.now(), packs };
  return NextResponse.json({ packs });
}
