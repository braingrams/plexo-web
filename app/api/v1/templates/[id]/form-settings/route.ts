import { NextRequest, NextResponse } from "next/server";
import { resolveSiteLayoutAdmin } from "@/lib/siteLayoutDynamo";
import { FormSettingsError, listFormSettings, saveFormSettings } from "@/lib/forms/formSettingsService";

/** GET — every form on the site and where its submissions go, plus the site's MailDrip connection and lists. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, id);
  if ("error" in resolved) return resolved.error;
  return NextResponse.json(await listFormSettings(resolved.context.templateId));
}

/**
 * PUT — where one form sends submissions besides the inbox and the owner's email.
 * Body: { formName, maildripGroupId?: string | null, webhookUrl?: string | null } (null clears it).
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, id);
  if ("error" in resolved) return resolved.error;
  const body = (await request.json().catch(() => null)) as { formName?: string; maildripGroupId?: string | null; webhookUrl?: string | null } | null;
  try {
    const form = await saveFormSettings(resolved.context.templateId, { formName: body?.formName ?? "", maildripGroupId: body?.maildripGroupId, webhookUrl: body?.webhookUrl });
    return NextResponse.json({ form });
  } catch (err) {
    if (err instanceof FormSettingsError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
