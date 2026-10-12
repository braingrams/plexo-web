import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/authDynamo";
import { Payment } from "@/lib/db/ledgerEntities";
import { sendReceiptEmail, type PaymentItem } from "@/lib/billing/payments";

/** POST /api/billing/receipts/:paymentId/email — emails the receipt to the signed-in owner again. */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Please sign in to do that." }, { status: 401 });

  const { id } = await context.params;
  const { data: payment } = await Payment.get({ id }).go();
  if (!payment || payment.userId !== session.user.id) {
    return NextResponse.json({ error: "We couldn't find that receipt." }, { status: 404 });
  }
  try {
    const { to } = await sendReceiptEmail(payment as PaymentItem);
    return NextResponse.json({ sent: true, to });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "We couldn't send that email. Please try again." }, { status: 502 });
  }
}
