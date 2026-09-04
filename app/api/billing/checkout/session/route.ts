import { NextRequest, NextResponse } from "next/server";

import { getStripe } from "@/lib/stripe";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";

/**
 * Backs the post-embedded-checkout landing on /dashboard/settings/subscription — Stripe's
 * embedded Checkout still does a final `return_url` navigation once payment completes (only
 * the card-entry step itself is embedded, not the whole flow), landing here with
 * ?session_id=. The actual plan/credit update is driven by the checkout.session.completed
 * webhook (app/api/webhooks/stripe/route.ts), same as before — this route only lets the page
 * show an honest "payment received" state immediately, without waiting on or re-deriving
 * that webhook's own effects.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required." }, { status: 400 });
  }

  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) throw new Error(`Session user ${session.user.id} has no matching User record`);

  try {
    const checkoutSession = await getStripe().checkout.sessions.retrieve(sessionId);
    // Never let a caller probe an arbitrary session id — only their own checkout, tied to
    // their own Stripe customer.
    if (!user.stripeCustomerId || checkoutSession.customer !== user.stripeCustomerId) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({ status: checkoutSession.status, paymentStatus: checkoutSession.payment_status });
  } catch {
    return NextResponse.json({ error: "Couldn't look up that checkout session." }, { status: 502 });
  }
}
