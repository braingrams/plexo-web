import { NextRequest, NextResponse } from "next/server";
import { authorizeSite } from "@/lib/sites/authorizeSite";
import { loadConsentSettings, normalizeConsentInput, saveConsentSettings } from "@/lib/consent/settings";
import { forgetTag } from "@/lib/googleAnalytics/connection";

/**
 * The cookie notice visitors in Europe, the UK, Switzerland and Brazil see before Google's tag loads.
 *   GET → the current settings (defaults when the owner never changed anything)
 *   PUT { enabled?, message?, acceptLabel?, declineLabel?, position?, accentColor? } → saves, returns the settings
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const a = await authorizeSite(request, (await ctx.params).id);
  if (a.error) return a.error;
  return NextResponse.json({ settings: await loadConsentSettings(a.site.id) });
}

export async function PUT(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const a = await authorizeSite(request, (await ctx.params).id);
  if (a.error) return a.error;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  const result = normalizeConsentInput(body, await loadConsentSettings(a.site.id));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await saveConsentSettings({ id: a.site.id, organizationId: a.site.organizationId }, result.settings);
  forgetTag(a.site.id);
  return NextResponse.json({ settings: result.settings });
}
