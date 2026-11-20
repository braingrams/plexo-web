import { NextRequest, NextResponse } from "next/server";
import { recordVisit } from "@/lib/pub/recordVisit";

/**
 * POST /__plexo/v on a site's own address (middleware rewrites it here). The page's counting script sends one small
 * request per opened page; it is never cached, so visits are counted the same whether the page came from the edge or
 * from the server. Always answers 204: the visitor never sees a problem, and a count that fails is simply not counted.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ domain: string }> }): Promise<NextResponse> {
  const empty = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  try {
    const { domain } = await ctx.params;
    const text = await request.text();
    if (text.length > 2000) return empty();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return empty();
    }
    await recordVisit({ domain: decodeURIComponent(domain).toLowerCase(), body, headers: request.headers });
  } catch (err) {
    console.error("visit beacon:", err instanceof Error ? err.message : "unknown error");
  }
  return empty();
}
