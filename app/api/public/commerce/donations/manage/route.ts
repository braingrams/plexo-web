import { NextRequest, NextResponse } from "next/server";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { CommerceDonationCampaign, CommerceDonationSubscription } from "@/lib/db/commerceEntities";
import { cancelDonationSubscription, DonationError } from "@/lib/commerce/donations";

async function findByToken(token: string | null) {
  if (!token || token.length < 20) return null;
  const { data } = await CommerceDonationSubscription.query.byManageToken({ manageToken: token }).go({ pages: "all" });
  return data[0] ?? null;
}

/** GET ?token= — a donor's own monthly gift, from the private link in their receipt. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sub = await findByToken(request.nextUrl.searchParams.get("token"));
  if (!sub) return NextResponse.json({ error: "This link isn't valid any more." }, { status: 404 });
  const { data: campaign } = await CommerceDonationCampaign.get({ templateId: sub.templateId, id: sub.campaignId }).go();
  return NextResponse.json({
    gift: { amountMinor: sub.amountMinor, currency: sub.currency, status: sub.status, campaignName: campaign?.name ?? null, since: sub.createdAt, cancelledAt: sub.cancelledAt ?? null },
  });
}

/** POST { token } — the donor stops their own monthly gift. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await checkCommerceRateLimit(`commerce:donation-manage:${clientIp(request)}`, 10))) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const sub = await findByToken(body.token ?? null);
  if (!sub) return NextResponse.json({ error: "This link isn't valid any more." }, { status: 404 });
  try {
    await cancelDonationSubscription(sub, "donor");
  } catch (err) {
    if (err instanceof DonationError) {
      return NextResponse.json({ error: "We couldn't stop your gift automatically — please reply to your receipt email and we'll stop it for you." }, { status: 502 });
    }
    throw err;
  }
  return NextResponse.json({ cancelled: true });
}
