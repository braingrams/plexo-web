import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { verifyAndApplyPaystackReference } from "@/lib/billing/paystackBilling";

/**
 * GET /api/billing/paystack/verify?reference=… — called when Paystack's popup (or its
 * redirect) reports success. Confirms the payment with Paystack and applies it at once, so the
 * new plan or credits show without waiting for the webhook (which applies it too, safely).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const reference = request.nextUrl.searchParams.get("reference");
  if (!reference) return NextResponse.json({ error: "reference is required." }, { status: 400 });
  try {
    const result = await verifyAndApplyPaystackReference(reference, session.user.id);
    if (result.status === "not_found") return NextResponse.json({ error: "We couldn't find that payment." }, { status: 404 });
    return NextResponse.json({ status: result.status === "success" ? "complete" : result.status, applied: result.applied, plan: result.plan ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("paystack verify failed", err);
    return NextResponse.json({ error: "We couldn't confirm your payment yet. If you were charged, your plan will update in a few minutes." }, { status: 502 });
  }
}
