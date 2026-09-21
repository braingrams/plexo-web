import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { refundCommerceOrder, OrderActionError } from "@/lib/commerce/orderStatusActions";

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
  const { organizationId, role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  try {
    const order = await refundCommerceOrder(templateId, organizationId, id);
    return NextResponse.json({ order });
  } catch (err) {
    const status = err instanceof OrderActionError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Refund failed." }, { status });
  }
}
