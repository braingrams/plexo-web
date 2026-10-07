import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { resolveBankTransferOrder, withoutOrderSecrets } from "@/lib/commerce/bankTransfer";
import { OrderActionError } from "@/lib/commerce/orderStatusActions";

/** Confirms ("I received the money") or rejects ("it never arrived") an awaiting bank
 * transfer from the dashboard. Body: { action: "confirm" | "reject", reason? }. Same logic
 * as the owner's one-click email link — see lib/commerce/bankTransfer.ts. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { userId, role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  if (body?.action !== "confirm" && body?.action !== "reject") {
    return NextResponse.json({ error: 'action must be "confirm" or "reject".' }, { status: 400 });
  }

  try {
    const order = await resolveBankTransferOrder({
      templateId,
      orderId: id,
      action: body.action,
      resolvedBy: `dashboard:${userId}`,
      reason: typeof body.reason === "string" ? body.reason : null,
    });
    return NextResponse.json({ order: withoutOrderSecrets(order) });
  } catch (err) {
    const status = err instanceof OrderActionError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't update this order." }, { status });
  }
}
