import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { cancelPaystackPlan } from "@/lib/billing/paystackBilling";

/**
 * POST /api/billing/cancel — stop a local-currency (Paystack) plan from renewing. The plan
 * keeps working until the end of what was paid for. (USD plans are managed in Stripe's
 * billing portal — /api/billing/portal.)
 */
export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  try {
    const { endsAt } = await cancelPaystackPlan(user);
    const when = endsAt ? new Date(endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "the end of this period";
    return NextResponse.json({ success: true, endsAt, message: `Your plan won't renew. Everything keeps working until ${when}.` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "We couldn't cancel your plan." }, { status: 400 });
  }
}
