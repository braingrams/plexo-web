import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { CommerceDonationCampaign, CommerceSettings } from "@/lib/db/commerceEntities";
import { publicCampaignView } from "@/lib/commerce/donations";

/** GET — what a donate form on this site needs to render (amounts, currency, monthly option, progress). */
export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string }> }): Promise<NextResponse> {
  const { campaignId } = await context.params;
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const site = await resolveSite(hostname);
  if (site.status !== "ok") return NextResponse.json({ error: "Site not found." }, { status: 404 });
  const templateId = site.published.templateId;
  const [{ data: campaign }, { data: settings }] = await Promise.all([
    CommerceDonationCampaign.get({ templateId, id: campaignId }).go(),
    CommerceSettings.get({ templateId }).go(),
  ]);
  if (!campaign) return NextResponse.json({ error: "This donation form no longer exists." }, { status: 404 });
  return NextResponse.json({ campaign: publicCampaignView(campaign, settings) }, { headers: { "Cache-Control": "no-store" } });
}
