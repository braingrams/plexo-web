import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { countryFromHeaders } from "@/lib/billing/region";
import { effectiveCountry } from "@/lib/billing/pricing";
import { shouldAskCountry } from "@/lib/countries";
import { saveUserCountry } from "@/lib/countryProfile";

const noStore = { "Cache-Control": "no-store" };

/** GET → the owner's country, a best guess to pre-select (their saved billing country, else where the request comes from), and whether to ask now. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  const guess = effectiveCountry({ billingCountry: user.billingCountry, headerCountry: countryFromHeaders(request.headers) });
  return NextResponse.json({ country: user.country ?? null, guess, shouldAsk: shouldAskCountry(user) }, { headers: noStore });
}

/** PUT { country } → save it. (The dashboard prompt can't be put off, so there is no "later".) */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { country?: unknown };
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  const result = await saveUserCountry(user, body.country);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ country: result.country }, { headers: noStore });
}
