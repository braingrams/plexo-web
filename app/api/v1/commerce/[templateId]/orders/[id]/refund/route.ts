import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { decryptPaystackKey } from "@/lib/crypto";
import { refundPaystackTransaction } from "@/lib/paystack";
import { resolvePaystackKeysForMode } from "@/lib/commerce/paystack";

/**
 * Refunds a paid order via Paystack. Deliberately does NOT auto-restock or free a booking
 * slot — whether a refunded item goes back into inventory (damaged goods vs. a change of
 * mind) is a judgment call the plan leaves to a separate, deliberate admin action, not
 * something a refund click should assume either way.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const order = await prisma.commerceOrder.findFirst({ where: { id, templateId } });
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.status !== "PAID") {
    return NextResponse.json({ error: `Only a PAID order can be refunded (this one is ${order.status}).` }, { status: 400 });
  }

  // paystackMode/paystackReference are only set on a Paystack-paid order (BYO or platform);
  // a PLATFORM_STRIPE order has neither — refunding one needs a Stripe-specific path that
  // doesn't exist yet.
  if (!order.paystackMode || !order.paystackReference) {
    return NextResponse.json({ error: "This order wasn't paid via Paystack — refunding it isn't supported yet." }, { status: 400 });
  }

  const settings = await prisma.commerceSettings.findUnique({ where: { templateId } });
  // Refund through the same account the order was actually PAID through — order.paystackMode
  // was stamped at creation time and never changes, regardless of what the site's active
  // mode has since been switched to.
  const orderModeKeys = settings ? resolvePaystackKeysForMode(settings, order.paystackMode) : null;
  if (!orderModeKeys?.secretKeyEncrypted) {
    return NextResponse.json({ error: `This site has no ${order.paystackMode.toLowerCase()}-mode Paystack key configured to refund through.` }, { status: 400 });
  }

  try {
    await refundPaystackTransaction({
      secretKey: decryptPaystackKey(orderModeKeys.secretKeyEncrypted),
      reference: order.paystackReference,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Refund failed." }, { status: 502 });
  }

  const updated = await prisma.commerceOrder.update({ where: { id }, data: { status: "REFUNDED" } });
  return NextResponse.json({ order: updated });
}
