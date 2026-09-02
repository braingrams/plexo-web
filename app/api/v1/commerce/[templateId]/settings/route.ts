import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin, maskSecret } from "@/lib/commerce/adminAuthDynamo";
import { encryptPaystackKey, decryptPaystackKey, encryptMaildripKey, decryptMaildripKey } from "@/lib/crypto";
import { CommerceSettings, CommerceStripeAccessRequest } from "@/lib/db/commerceEntities";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: settings } = await CommerceSettings.get({ templateId }).go();

  return NextResponse.json({
    settings: {
      enabled: settings?.enabled ?? false,
      paymentProvider: settings?.paymentProvider ?? "BYO_PAYSTACK",
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

  const permissionError = requirePermission(role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const {
    enabled,
    paymentProvider,
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

  if (
    paymentProvider !== undefined &&
    paymentProvider !== "BYO_PAYSTACK" &&
    paymentProvider !== "PLATFORM_PAYSTACK" &&
    paymentProvider !== "PLATFORM_STRIPE"
  ) {
    return NextResponse.json({ error: "paymentProvider must be BYO_PAYSTACK, PLATFORM_PAYSTACK, or PLATFORM_STRIPE." }, { status: 400 });
  }

  // Platform Stripe is admin-gated — see CommerceStripeAccessRequest and the
  // request/approval flow in app/api/v1/commerce/stripe-access/route.ts + plexo-admin.
  // Platform Paystack needs no such gate (opt-in, uses Plexo's own Paystack account
  // automatically).
  if (paymentProvider === "PLATFORM_STRIPE") {
    const { data: requests } = await CommerceStripeAccessRequest.query.primary({ organizationId }).go();
    const approved = requests.some((r) => r.status === "APPROVED");
    if (!approved) {
      return NextResponse.json(
        { error: "Platform Stripe isn't approved for this organization yet. Request access first." },
        { status: 400 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  type RemovableField =
    | "paystackTestPublicKey"
    | "paystackLivePublicKey"
    | "maildripPaidGroupId"
    | "maildripNewsletterGroupId"
    | "notificationEmail";
  const toRemove: RemovableField[] = [];

  if (typeof enabled === "boolean") data.enabled = enabled;
  if (paymentProvider !== undefined) data.paymentProvider = paymentProvider;
  if (paystackMode !== undefined) data.paystackMode = paystackMode;
  if (typeof paystackTestPublicKey === "string") {
    if (paystackTestPublicKey) data.paystackTestPublicKey = paystackTestPublicKey;
    else toRemove.push("paystackTestPublicKey");
  }
  if (typeof paystackLivePublicKey === "string") {
    if (paystackLivePublicKey) data.paystackLivePublicKey = paystackLivePublicKey;
    else toRemove.push("paystackLivePublicKey");
  }
  // A non-empty string replaces the key; an empty string / omitted leaves it unset on
  // create, or unchanged on update — never overwritten with a blank value just because
  // the form round-tripped a masked placeholder.
  if (typeof paystackTestSecretKey === "string" && paystackTestSecretKey) {
    data.paystackTestSecretKeyEncrypted = encryptPaystackKey(paystackTestSecretKey);
  }
  if (typeof paystackLiveSecretKey === "string" && paystackLiveSecretKey) {
    data.paystackLiveSecretKeyEncrypted = encryptPaystackKey(paystackLiveSecretKey);
  }
  if (typeof maildripApiKey === "string" && maildripApiKey) {
    data.maildripApiKeyEncrypted = encryptMaildripKey(maildripApiKey);
  }
  if (typeof maildripPaidGroupId === "string") {
    if (maildripPaidGroupId) data.maildripPaidGroupId = maildripPaidGroupId;
    else toRemove.push("maildripPaidGroupId");
  }
  if (typeof maildripNewsletterGroupId === "string") {
    if (maildripNewsletterGroupId) data.maildripNewsletterGroupId = maildripNewsletterGroupId;
    else toRemove.push("maildripNewsletterGroupId");
  }
  if (typeof notificationEmail === "string") {
    if (notificationEmail) data.notificationEmail = notificationEmail;
    else toRemove.push("notificationEmail");
  }

  const { data: existing } = await CommerceSettings.get({ templateId }).go();
  if (existing) {
    let patch = CommerceSettings.patch({ templateId }).set(data);
    if (toRemove.length) patch = patch.remove(toRemove);
    await patch.go();
  } else {
    await CommerceSettings.create({ id: randomUUID(), templateId, organizationId, ...data }).go();
  }
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings) throw new Error(`CommerceSettings for template ${templateId} vanished immediately after being saved`);

  return NextResponse.json({
    settings: {
      enabled: settings.enabled,
      paymentProvider: settings.paymentProvider,
      paystackMode: settings.paystackMode,
      paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
      paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
      paystackTestSecretKeyMasked: settings.paystackTestSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackTestSecretKeyEncrypted)) : null,
      paystackLiveSecretKeyMasked: settings.paystackLiveSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted)) : null,
      maildripApiKeyMasked: settings.maildripApiKeyEncrypted ? maskSecret(decryptMaildripKey(settings.maildripApiKeyEncrypted)) : null,
      maildripPaidGroupId: settings.maildripPaidGroupId ?? null,
      maildripNewsletterGroupId: settings.maildripNewsletterGroupId ?? null,
      notificationEmail: settings.notificationEmail ?? null,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/paystack/${templateId}`,
    },
  });
}
