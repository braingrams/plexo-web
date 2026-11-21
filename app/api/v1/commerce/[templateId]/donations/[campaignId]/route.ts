import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceDonationCampaign } from "@/lib/db/commerceEntities";
import { normalizeCampaignInput } from "@/lib/commerce/donations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** PATCH — edit a campaign (amounts, monthly option, goal, thank-you message, on/off). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ templateId: string; campaignId: string }> }): Promise<NextResponse> {
  const { templateId, campaignId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const permissionError = requirePermission(resolved.context.role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const { data: existing } = await CommerceDonationCampaign.get({ templateId, id: campaignId }).go();
  if (!existing) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const normalized = normalizeCampaignInput(body, true);
  if ("error" in normalized) return NextResponse.json({ error: normalized.error }, { status: 400 });
  const values = Object.fromEntries(Object.entries(normalized.values).filter(([, v]) => v !== undefined));
  if (Object.keys(values).length > 0) await CommerceDonationCampaign.patch({ templateId, id: campaignId }).set(values).go();
  const { data: campaign } = await CommerceDonationCampaign.get({ templateId, id: campaignId }).go();
  return NextResponse.json({ campaign }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}

/**
 * DELETE — turns a campaign off rather than erasing it: its gifts stay in Orders with their
 * campaign name, and any donate form still pointing at it shows "not accepting" instead of
 * breaking. Monthly donors on it keep giving until stopped individually.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ templateId: string; campaignId: string }> }): Promise<NextResponse> {
  const { templateId, campaignId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const permissionError = requirePermission(resolved.context.role, { commerce: ["delete"] });
  if (permissionError) return permissionError;
  await CommerceDonationCampaign.patch({ templateId, id: campaignId }).set({ active: false }).go();
  return NextResponse.json({ archived: true });
}
