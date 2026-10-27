import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/authDynamo";
import { Payment } from "@/lib/db/ledgerEntities";
import { User } from "@/lib/db/coreEntities";
import { isSettled, type PaymentItem } from "@/lib/billing/payments";
import { buildReceiptPdf } from "@/lib/billing/receiptPdf";

/**
 * GET /api/billing/receipts/:paymentId — the Plexo-branded receipt PDF, drawn from our own
 * Payment record (no Stripe call). Allowed for the signed-in owner, or anyone holding the
 * unguessable `t` token from the receipt email / the admin console — so the email's
 * "Download receipt" button works even when they're not signed in. `?view=1` shows it in the
 * browser instead of downloading it.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const { data: payment } = await Payment.get({ id }).go();
  const notFound = () => NextResponse.json({ error: "We couldn't find that receipt." }, { status: 404 });
  if (!payment) return notFound();

  const token = request.nextUrl.searchParams.get("t");
  let allowed = false;
  if (token) {
    const a = Buffer.from(token);
    const b = Buffer.from(payment.receiptToken);
    allowed = a.length === b.length && timingSafeEqual(a, b);
  }
  if (!allowed) {
    const session = await auth();
    allowed = !!session?.user && session.user.id === payment.userId;
  }
  if (!allowed) return notFound(); // same answer as a missing receipt — don't confirm it exists

  if (!isSettled(payment.status) || !payment.receiptNumber) {
    return NextResponse.json({ error: "This payment didn't go through, so there's no receipt for it." }, { status: 409 });
  }

  const { data: user } = await User.get({ id: payment.userId }).go();
  const pdf = await buildReceiptPdf(payment as PaymentItem, {
    name: user?.name && user.name !== "Plexo User" ? user.name : (payment.billingName ?? null),
    email: user?.email ?? payment.billingEmail ?? null,
  });
  const disposition = request.nextUrl.searchParams.get("view") ? "inline" : "attachment";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="Plexo-receipt-${payment.receiptNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
