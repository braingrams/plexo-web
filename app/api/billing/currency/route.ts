import { NextResponse } from "next/server";

/**
 * POST /api/billing/currency used to be the "Pay in USD instead" switch. Prices are now always in the owner's own
 * country currency, so there is nothing to switch. Kept so an old open tab gets a clear answer, not a 404.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "Prices are shown in your country's currency. If it looks wrong, update your country in Settings." }, { status: 410 });
}
