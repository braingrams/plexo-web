import { NextRequest, NextResponse } from "next/server";
import { User } from "@/lib/db/coreEntities";
import { countryFromHeaders, hasRunningSubscription, pricingViewFor } from "@/lib/billing/region";
import { currencyChoices } from "@/lib/billing/pricing";
import { loadPriceBook } from "@/lib/billing/priceBook";
import { auth } from "@/server/authDynamo";

/**
 * POST /api/billing/currency { currency: "USD" | "LOCAL" } — the "Pay in USD instead" switch
 * (and back). Only while no plan is being paid for: a running subscription keeps its currency.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { currency?: unknown };
  if (body.currency !== "USD" && body.currency !== "LOCAL") {
    return NextResponse.json({ error: "Choose USD or your local currency." }, { status: 400 });
  }
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (hasRunningSubscription(user)) {
    return NextResponse.json({ error: "Your plan is paid in its current currency. To switch, cancel it first and choose again when it ends." }, { status: 409 });
  }
  const country = user.billingCountry ?? countryFromHeaders(request.headers);
  const book = await loadPriceBook();
  const choices = currencyChoices(book, { headerCountry: country, billingCountry: user.billingCountry });
  if (!choices) return NextResponse.json({ error: "Prices are already in US dollars for your country." }, { status: 400 });
  const region = body.currency === "USD" ? choices.usd : choices.local;
  await User.patch({ id: user.id })
    .set({ ...(country ? { billingCountry: country.toUpperCase() } : {}), billingCurrency: region.currency, billingRegion: region.id })
    .go();
  const { data: updated } = await User.get({ id: user.id }).go();
  return NextResponse.json(pricingViewFor(book, updated, request.headers));
}
