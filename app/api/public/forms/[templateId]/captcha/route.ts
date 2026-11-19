import { NextRequest, NextResponse } from "next/server";

import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { FormSettings } from "@/lib/db/opsEntities";

/**
 * Tells public/plexo-forms.js whether a form has a captcha to show: { provider, siteKey } or
 * { provider: null }. Only a form whose secret key is saved gets one — a widget with nothing
 * to verify it would just be friction. The site key is public by design; the secret never leaves.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await params;
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const site = await resolveSite(hostname);
  const none = NextResponse.json({ provider: null }, { headers: { "Cache-Control": "public, max-age=60" } });
  if (site.status !== "ok" || site.published.templateId !== templateId) return none;
  const formName = request.nextUrl.searchParams.get("form")?.slice(0, 100) || "Website Form";
  const { data } = await FormSettings.get({ templateId, formName }).go();
  if (!data?.captchaProvider || !data.captchaSiteKey || !data.captchaSecretEncrypted) return none;
  return NextResponse.json({ provider: data.captchaProvider, siteKey: data.captchaSiteKey }, { headers: { "Cache-Control": "public, max-age=60" } });
}
