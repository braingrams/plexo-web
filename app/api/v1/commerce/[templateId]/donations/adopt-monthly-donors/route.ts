import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { adoptExistingMonthlyDonors, DonationError } from "@/lib/commerce/donations";

export const maxDuration = 60;

/**
 * POST { campaignId } — bring monthly donors over from the previous site: their gifts keep
 * billing on the same Stripe/Paystack account (nothing for donors to redo), and from now on
 * every charge is recorded, receipted and counted in Plexo.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const permissionError = requirePermission(resolved.context.role, { commerce: ["update"] });
  if (permissionError) return permissionError;
  const body = (await request.json().catch(() => ({}))) as { campaignId?: string };
  if (!body.campaignId) return NextResponse.json({ error: "Choose which campaign these donors belong to." }, { status: 400 });
  try {
    return NextResponse.json(await adoptExistingMonthlyDonors(templateId, resolved.context.organizationId, body.campaignId));
  } catch (err) {
    if (err instanceof DonationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
