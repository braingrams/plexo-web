import { NextRequest, NextResponse } from "next/server";
import { User } from "@/lib/db/coreEntities";
import { billingRegionFor } from "@/lib/billing/region";
import { loadPriceBook } from "@/lib/billing/priceBook";
import { topupPacksFor } from "@/lib/billing/pricing";
import { auth } from "@/server/authDynamo";

/** GET /api/billing/topup-packs → the credit packs in the person's currency, with the credits
 *  each grants (flat rate — lib/billing/pricing.ts), for top-up pickers. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: user } = await User.get({ id: session.user.id }).go();
  const region = billingRegionFor(await loadPriceBook(), user, request.headers);
  const packs = topupPacksFor(region).map((p) => ({ pack: p.pack, credits: p.credits, price: p.price, currency: p.currency }));
  return NextResponse.json({ packs, provider: region.provider, currency: region.currency }, { headers: { "Cache-Control": "no-store" } });
}
