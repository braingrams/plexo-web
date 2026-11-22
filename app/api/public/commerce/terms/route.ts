import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { Template } from "@/lib/db/contentEntities";
import { renderTermsHtml } from "@/lib/commerce/terms";

/** The shop's terms of sale as a plain readable page, on the shop's own address. Linked from checkout and order emails. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const site = await resolveSite(hostname);
  if (site.status !== "ok") return new NextResponse("Not found", { status: 404 });
  const templateId = site.published.templateId;
  const [{ data: settings }, { data: tpl }] = await Promise.all([CommerceSettings.get({ templateId }).go(), Template.get({ id: templateId }).go()]);
  const text = settings?.termsText?.trim();
  if (!text) return new NextResponse("This shop hasn't written its terms yet.", { status: 404 });
  return new NextResponse(renderTermsHtml(tpl?.name ?? "Our shop", text), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
