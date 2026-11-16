import { NextRequest, NextResponse } from "next/server";
import { User } from "@/lib/db/coreEntities";
import { countryFromHeaders, pricingViewFor } from "@/lib/billing/region";
import { currencyChoices, pricingView, resolvePriceRegion } from "@/lib/billing/pricing";
import { loadPriceBook } from "@/lib/billing/priceBook";
import { auth } from "@/server/authDynamo";

/**
 * GET /api/billing/pricing → the price list this person sees (currency, plan prices, yearly
 * prices, top-up packs, and whether "Pay in USD instead" is offered). Signed out (the
 * register page), it's worked out from where the request comes from.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const headers = { "Cache-Control": "no-store" };
  const book = await loadPriceBook();
  if (!session?.user) {
    const input = { headerCountry: countryFromHeaders(request.headers) };
    return NextResponse.json(pricingView(resolvePriceRegion(book, input), { choices: currencyChoices(book, input) }), { headers });
  }
  const { data: user } = await User.get({ id: session.user.id }).go();
  return NextResponse.json(pricingViewFor(book, user, request.headers), { headers });
}
