import { NextRequest, NextResponse } from "next/server";
import { authorizeSite } from "@/lib/sites/authorizeSite";
import { loadHealthStatus, runSiteCheck } from "@/lib/siteHealth/service";
import { pageForLinks } from "@/lib/siteHealth/editorLinks";
import { presentHealth as present } from "@/lib/siteHealth/present";

/**
 * A site's health check.
 *   GET  → the last result, the trend, the problems found and which fixes are on
 *   POST → run a new check (answers with the remembered one if the last was under 5 minutes ago, or 1 minute after a publish or a fix)
 */
type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 90;

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const a = await authorizeSite(request, (await ctx.params).id);
  if (a.error) return a.error;
  return NextResponse.json(present(await loadHealthStatus(a.site.id), { html: a.site.compiledHtml, page: pageForLinks(a.site) }));
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const a = await authorizeSite(request, (await ctx.params).id);
  if (a.error) return a.error;
  const outcome = await runSiteCheck({ id: a.site.id, organizationId: a.site.organizationId });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status ?? 500 });
  return NextResponse.json({ ...present(outcome.status, { html: a.site.compiledHtml, page: pageForLinks(a.site) }), cached: outcome.cached });
}
