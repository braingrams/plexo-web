import { NextRequest, NextResponse } from "next/server";
import { brandStore, BRAND_SHEET_CACHE_CONTROL, isSiteId } from "@/lib/brand/store";

/**
 * GET /__plexo/brand/<siteId>.css (rewritten here by middleware.ts on a site's own domain)
 *
 * The site's hosted brand sheet (lib/brand/siteBrand.ts writes it). Public: it is the same CSS every visitor's browser loads.
 * Short caching (a minute in browsers, five at the edge, then served stale while refreshing) so a brand published in Strata
 * reaches visitors quickly even where the page's link can't carry a new ?v=. A site with no brand gets an empty sheet (not a
 * 404), so a page that still links to it never shows a console error and keeps its built-in look.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ file: string }> }): Promise<NextResponse> {
  const { file } = await context.params;
  const siteId = file.replace(/\.css$/i, "");
  const headers = { "Content-Type": "text/css; charset=utf-8", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*" };
  if (!file.toLowerCase().endsWith(".css") || !isSiteId(siteId)) return new NextResponse("/* not found */", { status: 404, headers: { ...headers, "Cache-Control": "public, max-age=60" } });
  let css: string | null = null;
  try {
    css = await brandStore().getSheet(siteId);
  } catch (err) {
    console.error(`[site-brand] couldn't read the sheet for ${siteId}`, err);
    // Don't cache a failure for long: the next request tries again.
    return new NextResponse("/* brand temporarily unavailable */", { status: 503, headers: { ...headers, "Cache-Control": "no-store", "Retry-After": "30" } });
  }
  return new NextResponse(css ?? "/* no brand linked */\n", { headers: { ...headers, "Cache-Control": BRAND_SHEET_CACHE_CONTROL } });
}
