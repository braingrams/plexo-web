import { NextRequest, NextResponse } from "next/server";
import { CommerceOrder } from "@/lib/db/commerceEntities";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { isValidBankTransferToken, resolveBankTransferOrder } from "@/lib/commerce/bankTransfer";
import { OrderActionError } from "@/lib/commerce/orderStatusActions";

/**
 * The owner's one-click "confirm payment received" link (emailed by
 * notifyBankTransferPlaced) posts here from app/commerce/bank-transfer/page.tsx. No login
 * needed — the per-order secret token in the link IS the authorization, scoped to exactly
 * one decision on one order. It's a POST behind a button (never a bare GET), so an email
 * client's link scanner pre-fetching the URL can't confirm a payment on its own.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const allowed = await checkCommerceRateLimit(`commerce:bank-transfer-link:${clientIp(request)}`, 20);
  if (!allowed) return NextResponse.json({ error: "Too many attempts. Please wait a minute and try again." }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const { site, order: orderId, token, action, reason } = body ?? {};
  if (typeof site !== "string" || typeof orderId !== "string" || typeof token !== "string") {
    return NextResponse.json({ error: "This link is incomplete — open it again from the email." }, { status: 400 });
  }
  if (action !== "confirm" && action !== "reject") {
    return NextResponse.json({ error: 'action must be "confirm" or "reject".' }, { status: 400 });
  }

  const { data: order } = await CommerceOrder.get({ templateId: site, id: orderId }).go();
  if (!order || !isValidBankTransferToken(order, token)) {
    return NextResponse.json({ error: "This link isn't valid any more. Open the order from your Commerce dashboard instead." }, { status: 404 });
  }

  try {
    const updated = await resolveBankTransferOrder({
      templateId: site,
      orderId,
      action,
      resolvedBy: "email-link",
      reason: typeof reason === "string" ? reason : null,
    });
    return NextResponse.json({ status: updated.status });
  } catch (err) {
    const status = err instanceof OrderActionError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't update this order." }, { status });
  }
}
