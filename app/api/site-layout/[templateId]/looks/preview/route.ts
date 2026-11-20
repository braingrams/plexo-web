import { NextRequest, NextResponse } from "next/server";

import { resolveSiteLayoutAdmin } from "@/lib/siteLayoutDynamo";
import { previewLookHtml } from "@/lib/siteLayoutBlank";

/** GET ?kind=header|footer&variant=… — one ready-made look drawn in the site's own colours and fonts (a small, inert page for the picker). */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;
  const kind = request.nextUrl.searchParams.get("kind");
  const variant = request.nextUrl.searchParams.get("variant") ?? "";
  if (kind !== "header" && kind !== "footer") return NextResponse.json({ error: "Choose the header or the footer." }, { status: 400 });
  const html = await previewLookHtml(templateId, kind, variant);
  if (!html) return NextResponse.json({ error: "We couldn't draw that look just now." }, { status: 404 });
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, max-age=60", "Content-Security-Policy": "sandbox" } });
}
