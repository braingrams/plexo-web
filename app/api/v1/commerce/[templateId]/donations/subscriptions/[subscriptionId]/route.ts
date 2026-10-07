import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceDonationSubscription } from "@/lib/db/commerceEntities";
import { cancelDonationSubscription, DonationError } from "@/lib/commerce/donations";

/** DELETE — stop a donor's monthly gift (at Stripe/Paystack too), e.g. at the donor's request. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ templateId: string; subscriptionId: string }> }): Promise<NextResponse> {
  const { templateId, subscriptionId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const permissionError = requirePermission(resolved.context.role, { commerce: ["update"] });
  if (permissionError) return permissionError;
  const { data: sub } = await CommerceDonationSubscription.get({ templateId, id: subscriptionId }).go();
  if (!sub) return NextResponse.json({ error: "Monthly gift not found." }, { status: 404 });
  try {
    await cancelDonationSubscription(sub, `dashboard:${resolved.context.userId}`);
  } catch (err) {
    if (err instanceof DonationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  return NextResponse.json({ cancelled: true });
}
