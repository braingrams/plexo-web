import { NextResponse } from "next/server";
import { TOPUP_PACKS } from "@/lib/credits/catalog";
import { topupOffer, type TopupPackId } from "@/lib/credits/topupOffer";
import { getStripe } from "@/lib/stripe";
import { auth } from "@/server/authDynamo";

type Pack = { pack: TopupPackId; credits: number; price: string };

// Prices change rarely; one Stripe lookup per pack per instance per 10 minutes.
let cache: { at: number; packs: Pack[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** GET /api/billing/topup-packs → the credit packs with their real prices and the credits each
 *  grants (half the price as AI value — lib/credits/value.ts), for top-up pickers. */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json({ packs: cache.packs });
  const stripe = getStripe();
  const results = await Promise.all(
    (Object.keys(TOPUP_PACKS) as TopupPackId[]).map((pack) =>
      topupOffer(stripe, pack).then(
        (o): Pack => ({ pack, credits: o.credits, price: o.price }),
        (err) => {
          console.error(`[topup-packs] ${pack}:`, err);
          return null;
        },
      ),
    ),
  );
  const packs = results.filter((p): p is Pack => p !== null);
  if (packs.length === results.length) cache = { at: Date.now(), packs };
  return NextResponse.json({ packs });
}
