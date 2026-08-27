import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { decryptMaildripKey } from "@/lib/crypto";
import { createAndPublishMaildripOptInPage, MAILDRIP_API_KEYS_SETTINGS_URL, MAILDRIP_SIGNUP_URL } from "@/lib/maildripOptIn";

/**
 * Backs form_container's 'maildrip' provider "Create MailDrip Opt-in Page" action (see
 * PlexoBuilderProps.onCreateMaildripOptInPage, wired up in template-editor-client.tsx).
 * Reuses resolveCommerceAdmin purely for its auth + "is this caller's org" check — this
 * route has nothing else to do with Commerce, it just happens to be where a site's own
 * MailDrip API key already lives (CommerceSettings.maildripApiKeyEncrypted).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await params;
  const auth = await resolveCommerceAdmin(request, templateId);
  if (auth.error) return auth.error;

  let body: { title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }

  const settings = await prisma.commerceSettings.findUnique({
    where: { templateId },
    select: { maildripApiKeyEncrypted: true },
  });
  if (!settings?.maildripApiKeyEncrypted) {
    return NextResponse.json(
      {
        error: "Connect your MailDrip account first — add your API key in Commerce Settings.",
        needsMaildripKey: true,
        apiKeysUrl: MAILDRIP_API_KEYS_SETTINGS_URL,
        signupUrl: MAILDRIP_SIGNUP_URL,
      },
      { status: 400 },
    );
  }

  try {
    const apiKey = decryptMaildripKey(settings.maildripApiKeyEncrypted);
    const result = await createAndPublishMaildripOptInPage(apiKey, title);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create the MailDrip opt-in page.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
