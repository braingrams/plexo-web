import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { CommerceOrder } from "@/lib/db/commerceEntities";
import { isDonationOrder } from "@/lib/commerce/donations";
import { verifyOrderOnReturn } from "@/lib/commerce/verifyOnReturn";

/**
 * POST { order } — a donor just landed back on the donate page after paying; confirm the
 * gift with the gateway right away (see lib/commerce/verifyOnReturn.ts). Returns only the
 * status — nothing about the donor — so knowing an order number reveals nothing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const site = await resolveSite(hostname);
  if (site.status !== "ok") return NextResponse.json({ error: "Site not found." }, { status: 404 });
  if (!(await checkCommerceRateLimit(`commerce:donation-confirm:${site.published.templateId}:${clientIp(request)}`, 20))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { order?: string };
  const orderNumber = typeof body.order === "string" ? body.order.trim() : "";
  if (!orderNumber) return NextResponse.json({ error: "order is required." }, { status: 400 });
  const { data: matches } = await CommerceOrder.query.byOrderNumber({ orderNumber }).go({ pages: "all" });
  const order = matches.find((o) => o.templateId === site.published.templateId && isDonationOrder(o));
  if (!order) return NextResponse.json({ status: "UNKNOWN" });
  return NextResponse.json({ status: await verifyOrderOnReturn(order) });
}
