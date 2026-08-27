import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin, maskSecret } from "@/lib/commerce/adminAuth";
import { encryptPaystackKey, decryptPaystackKey, encryptMaildripKey, decryptMaildripKey } from "@/lib/crypto";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const settings = await prisma.commerceSettings.findUnique({ where: { templateId } });

  return NextResponse.json({
    settings: {
      enabled: settings?.enabled ?? false,
      paystackMode: settings?.paystackMode ?? "TEST",
      paystackTestPublicKey: settings?.paystackTestPublicKey ?? null,
      paystackLivePublicKey: settings?.paystackLivePublicKey ?? null,
      // Secrets are never returned in plaintext — only a masked hint that something is
      // configured, same idea as ApiKey.maskedKey.
      paystackTestSecretKeyMasked: settings?.paystackTestSecretKeyEncrypted
        ? maskSecret(decryptPaystackKey(settings.paystackTestSecretKeyEncrypted))
        : null,
      paystackLiveSecretKeyMasked: settings?.paystackLiveSecretKeyEncrypted
        ? maskSecret(decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted))
        : null,
      maildripApiKeyMasked: settings?.maildripApiKeyEncrypted ? maskSecret(decryptMaildripKey(settings.maildripApiKeyEncrypted)) : null,
      maildripPaidGroupId: settings?.maildripPaidGroupId ?? null,
      maildripNewsletterGroupId: settings?.maildripNewsletterGroupId ?? null,
      notificationEmail: settings?.notificationEmail ?? null,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/paystack/${templateId}`,
    },
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const {
    enabled,
    paystackMode,
    paystackTestPublicKey,
    paystackTestSecretKey,
    paystackLivePublicKey,
    paystackLiveSecretKey,
    maildripApiKey,
    maildripPaidGroupId,
    maildripNewsletterGroupId,
    notificationEmail,
  } = body;

  if (paystackMode !== undefined && paystackMode !== "TEST" && paystackMode !== "LIVE") {
    return NextResponse.json({ error: "paystackMode must be TEST or LIVE." }, { status: 400 });
  }

  const settings = await prisma.commerceSettings.upsert({
    where: { templateId },
    create: {
      templateId,
      organizationId,
      enabled: typeof enabled === "boolean" ? enabled : false,
      paystackMode: paystackMode ?? "TEST",
      paystackTestPublicKey: typeof paystackTestPublicKey === "string" && paystackTestPublicKey ? paystackTestPublicKey : null,
      paystackLivePublicKey: typeof paystackLivePublicKey === "string" && paystackLivePublicKey ? paystackLivePublicKey : null,
      // A non-empty string replaces the key; an empty string / omitted leaves it unset on
      // create, or unchanged on update (see the update branch below) — never overwritten
      // with a blank value just because the form round-tripped a masked placeholder.
      paystackTestSecretKeyEncrypted:
        typeof paystackTestSecretKey === "string" && paystackTestSecretKey ? encryptPaystackKey(paystackTestSecretKey) : null,
      paystackLiveSecretKeyEncrypted:
        typeof paystackLiveSecretKey === "string" && paystackLiveSecretKey ? encryptPaystackKey(paystackLiveSecretKey) : null,
      maildripApiKeyEncrypted: typeof maildripApiKey === "string" && maildripApiKey ? encryptMaildripKey(maildripApiKey) : null,
      maildripPaidGroupId: typeof maildripPaidGroupId === "string" && maildripPaidGroupId ? maildripPaidGroupId : null,
      maildripNewsletterGroupId: typeof maildripNewsletterGroupId === "string" && maildripNewsletterGroupId ? maildripNewsletterGroupId : null,
      notificationEmail: typeof notificationEmail === "string" && notificationEmail ? notificationEmail : null,
    },
    update: {
      enabled: typeof enabled === "boolean" ? enabled : undefined,
      paystackMode: paystackMode ?? undefined,
      paystackTestPublicKey: typeof paystackTestPublicKey === "string" ? paystackTestPublicKey || null : undefined,
      paystackLivePublicKey: typeof paystackLivePublicKey === "string" ? paystackLivePublicKey || null : undefined,
      paystackTestSecretKeyEncrypted:
        typeof paystackTestSecretKey === "string" && paystackTestSecretKey ? encryptPaystackKey(paystackTestSecretKey) : undefined,
      paystackLiveSecretKeyEncrypted:
        typeof paystackLiveSecretKey === "string" && paystackLiveSecretKey ? encryptPaystackKey(paystackLiveSecretKey) : undefined,
      maildripApiKeyEncrypted: typeof maildripApiKey === "string" && maildripApiKey ? encryptMaildripKey(maildripApiKey) : undefined,
      maildripPaidGroupId: typeof maildripPaidGroupId === "string" ? maildripPaidGroupId || null : undefined,
      maildripNewsletterGroupId: typeof maildripNewsletterGroupId === "string" ? maildripNewsletterGroupId || null : undefined,
      notificationEmail: typeof notificationEmail === "string" ? notificationEmail || null : undefined,
    },
  });

  return NextResponse.json({
    settings: {
      enabled: settings.enabled,
      paystackMode: settings.paystackMode,
      paystackTestPublicKey: settings.paystackTestPublicKey,
      paystackLivePublicKey: settings.paystackLivePublicKey,
      paystackTestSecretKeyMasked: settings.paystackTestSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackTestSecretKeyEncrypted)) : null,
      paystackLiveSecretKeyMasked: settings.paystackLiveSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted)) : null,
      maildripApiKeyMasked: settings.maildripApiKeyEncrypted ? maskSecret(decryptMaildripKey(settings.maildripApiKeyEncrypted)) : null,
      maildripPaidGroupId: settings.maildripPaidGroupId,
      maildripNewsletterGroupId: settings.maildripNewsletterGroupId,
      notificationEmail: settings.notificationEmail,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/paystack/${templateId}`,
    },
  });
}
