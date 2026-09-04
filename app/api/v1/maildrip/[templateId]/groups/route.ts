import { NextRequest, NextResponse } from "next/server";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { decryptMaildripKey } from "@/lib/crypto";
import { listMaildripGroups, createMaildripGroup } from "@/lib/maildripGroups";
import { CommerceSettings } from "@/lib/db/commerceEntities";

async function resolveApiKey(templateId: string): Promise<string | null> {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings?.maildripApiKeyEncrypted) return null;
  return decryptMaildripKey(settings.maildripApiKeyEncrypted);
}

/**
 * Backs the Notifications settings page's group dropdowns — once a site has connected
 * MailDrip (see app/api/v1/maildrip/[templateId]/connect/route.ts), this lists the real
 * groups on that account so the site owner picks from a real list instead of typing an
 * opaque group ID by hand.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await params;
  const auth = await resolveCommerceAdmin(request, templateId);
  if (auth.error) return auth.error;

  const apiKey = await resolveApiKey(templateId);
  if (!apiKey) return NextResponse.json({ error: "Connect MailDrip first." }, { status: 400 });

  try {
    const groups = await listMaildripGroups(apiKey);
    return NextResponse.json({ groups });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load your MailDrip groups." }, { status: 502 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await params;
  const auth = await resolveCommerceAdmin(request, templateId);
  if (auth.error) return auth.error;

  const apiKey = await resolveApiKey(templateId);
  if (!apiKey) return NextResponse.json({ error: "Connect MailDrip first." }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!title) return NextResponse.json({ error: "A group name is required." }, { status: 400 });

  try {
    const group = await createMaildripGroup(apiKey, title, description || undefined);
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't create that group." }, { status: 502 });
  }
}
