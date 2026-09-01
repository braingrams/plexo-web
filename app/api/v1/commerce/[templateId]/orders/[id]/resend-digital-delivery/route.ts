import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { resendDigitalDelivery } from "@/lib/commerce/digitalDelivery";

/**
 * Re-sends an already-created CommerceDigitalDelivery's email using its EXISTING token —
 * never regenerates it, so any link the buyer already has (or lost) keeps working. Body:
 * { deliveryId: string }, since one order can have several digital line items.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id: orderId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const deliveryId = typeof body.deliveryId === "string" ? body.deliveryId : null;
  if (!deliveryId) return NextResponse.json({ error: "deliveryId is required." }, { status: 400 });

  try {
    const updated = await resendDigitalDelivery(templateId, orderId, deliveryId);
    return NextResponse.json({ delivery: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resend failed.";
    const status = message === "Delivery not found." ? 404 : message.startsWith("No MailDrip") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
