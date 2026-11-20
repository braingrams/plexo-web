import { NextRequest, NextResponse } from "next/server";
import { authorizeSite } from "@/lib/sites/authorizeSite";
import { fixEverything, previewEverything, isAutoFixId, previewFix, setAutoFix, undoEverything } from "@/lib/siteHealth/fixes";
import { loadHealthStatus } from "@/lib/siteHealth/service";
import { pageForLinks } from "@/lib/siteHealth/editorLinks";
import { presentHealth } from "@/lib/siteHealth/present";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 90;

/**
 * POST one of:
 *   { fix, preview: true }              → what it would change, in words (nothing is changed)
 *   { fix, preview: true, regenerate? } → the same for fixes that write texts (page titles, picture descriptions): regenerate writes them again
 *   { fix, enabled, text?, business?, titles?, alts? } → turn one fix on or off. Off puts the page back exactly as it was.
 *                                         business / titles / alts are what the owner confirmed or edited in the preview.
 *   { all: true, enabled?: boolean }    → "Fix everything" (or, with enabled:false, undo every fix)
 */
export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const a = await authorizeSite(request, (await ctx.params).id);
  if (a.error) return a.error;
  const body = (await request.json().catch(() => ({}))) as { fix?: unknown; enabled?: unknown; language?: unknown; preview?: unknown; all?: unknown; text?: unknown; business?: unknown; titles?: unknown; alts?: unknown; regenerate?: unknown };
  const site = { id: a.site.id, organizationId: a.site.organizationId, name: a.site.name, compiledHtml: a.site.compiledHtml, userId: a.user.userId };
  const status = await loadHealthStatus(site.id);
  const last = status.last?.report ?? null;

  const after = async (extra: Record<string, unknown>) => NextResponse.json({ ...extra, ...presentHealth(await loadHealthStatus(site.id), { html: site.compiledHtml, page: pageForLinks(a.site) }) });

  if (body.all === true) {
    if (body.enabled === false) {
      await undoEverything(site, status.settings);
      return after({ undone: true });
    }
    if (!last) return NextResponse.json({ error: "Check your site first, so we know what to fix." }, { status: 409 });
    if (body.preview === true) return NextResponse.json(await previewEverything(site, status.settings, last));
    const { summary } = await fixEverything(site, status.settings, last);
    return after({ summary });
  }

  if (!isAutoFixId(body.fix)) return NextResponse.json({ error: "Tell us which fix you mean." }, { status: 400 });
  if (body.preview === true) return NextResponse.json(await previewFix(site, body.fix, status.settings, last, { regenerate: body.regenerate === true }));
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Tell us whether to turn it on or off." }, { status: 400 });

  const result = await setAutoFix(site, body.fix, body.enabled, { language: typeof body.language === "string" ? body.language : undefined, text: typeof body.text === "string" ? body.text : undefined, business: body.business, titles: body.titles, alts: body.alts });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return after({});
}
