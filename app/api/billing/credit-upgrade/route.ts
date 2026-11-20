import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { allowancePlan } from "@/lib/plan/entitlement";
import { creditUpgradeOffer } from "@/lib/credits/upgradeOffer";

/** GET — the plan that would grant this account more AI credits each month (null on the top plan), for the out-of-credits prompt. */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ offer: null });
  const { data: user } = await User.get({ id: session.user.id }).go();
  return NextResponse.json({ offer: user ? creditUpgradeOffer(allowancePlan(user)) : null }, { headers: { "Cache-Control": "no-store" } });
}
