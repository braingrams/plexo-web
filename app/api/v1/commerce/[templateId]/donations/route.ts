import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceDonationCampaign } from "@/lib/db/commerceEntities";
import { ensureDonationsReady, listDonationsOverview, normalizeCampaignInput } from "@/lib/commerce/donations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET — campaigns, monthly donors and recent gifts for this site's Donations dashboard. */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  return NextResponse.json(await listDonationsOverview(templateId, { allGifts: true }), {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

/** POST — create a donation campaign (and switch on everything donations need). */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role, userId } = resolved.context;
  const permissionError = requirePermission(role, { commerce: ["create"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const normalized = normalizeCampaignInput(body);
  if ("error" in normalized) return NextResponse.json({ error: normalized.error }, { status: 400 });

  await ensureDonationsReady(templateId, organizationId, userId);
  const id = randomUUID();
  await CommerceDonationCampaign.create({ ...normalized.values, id, templateId, organizationId, name: normalized.values.name!, presetAmounts: normalized.values.presetAmounts ?? [] }).go();
  const { data: campaign } = await CommerceDonationCampaign.get({ templateId, id }).go();
  return NextResponse.json({ campaign }, { status: 201, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
