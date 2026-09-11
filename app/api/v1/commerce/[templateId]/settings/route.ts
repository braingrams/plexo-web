import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin, maskSecret } from "@/lib/commerce/adminAuthDynamo";
import {
  encryptPaystackKey,
  decryptPaystackKey,
  encryptStripeKey,
  decryptStripeKey,
  encryptMaildripKey,
  decryptMaildripKey,
  tryDecrypt,
} from "@/lib/crypto";
import { isKnownCurrency, isPaystackCompatibleCurrency } from "@/lib/commerce/currency";
import { ensureProductDetailLayout } from "@/lib/commerce/productDetailLayout";
import { ensureStorefrontLayout, getStorefrontSlug, renameStorefrontSlug } from "@/lib/commerce/storefrontLayout";
import { CommerceSettings, CommerceStripeAccessRequest, CommerceOrder } from "@/lib/db/commerceEntities";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const storefrontSlug = await getStorefrontSlug(templateId);

  return NextResponse.json({
    settings: {
      enabled: settings?.enabled ?? false,
      storefrontSlug,
      currency: settings?.currency ?? "NGN",
      paymentProvider: settings?.paymentProvider ?? "BYO_PAYSTACK",
      paystackMode: settings?.paystackMode ?? "TEST",
      paystackTestPublicKey: settings?.paystackTestPublicKey ?? null,
      paystackLivePublicKey: settings?.paystackLivePublicKey ?? null,
      // Secrets are never returned in plaintext — only a masked hint that something is
      // configured, same idea as ApiKey.maskedKey.
      paystackTestSecretKeyMasked: settings?.paystackTestSecretKeyEncrypted
        ? maskSecret(tryDecrypt(() => decryptPaystackKey(settings.paystackTestSecretKeyEncrypted!)))
        : null,
      paystackLiveSecretKeyMasked: settings?.paystackLiveSecretKeyEncrypted
        ? maskSecret(tryDecrypt(() => decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted!)))
        : null,
      stripeMode: settings?.stripeMode ?? "TEST",
      stripeTestPublishableKey: settings?.stripeTestPublishableKey ?? null,
      stripeLivePublishableKey: settings?.stripeLivePublishableKey ?? null,
      stripeTestSecretKeyMasked: settings?.stripeTestSecretKeyEncrypted
        ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeTestSecretKeyEncrypted!)))
        : null,
      stripeLiveSecretKeyMasked: settings?.stripeLiveSecretKeyEncrypted
        ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeLiveSecretKeyEncrypted!)))
        : null,
      stripeTestWebhookSecretMasked: settings?.stripeTestWebhookSecretEncrypted
        ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeTestWebhookSecretEncrypted!)))
        : null,
      stripeLiveWebhookSecretMasked: settings?.stripeLiveWebhookSecretEncrypted
        ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeLiveWebhookSecretEncrypted!)))
        : null,
      maildripApiKeyMasked: settings?.maildripApiKeyEncrypted ? maskSecret(tryDecrypt(() => decryptMaildripKey(settings.maildripApiKeyEncrypted!))) : null,
      maildripPaidGroupId: settings?.maildripPaidGroupId ?? null,
      maildripNewsletterGroupId: settings?.maildripNewsletterGroupId ?? null,
      notificationEmail: settings?.notificationEmail ?? null,
      notifyCustomerOnPaid: settings?.notifyCustomerOnPaid ?? true,
      notifyCustomerOnProcessing: settings?.notifyCustomerOnProcessing ?? true,
      notifyCustomerOnReadyForPickup: settings?.notifyCustomerOnReadyForPickup ?? true,
      notifyCustomerOnShipped: settings?.notifyCustomerOnShipped ?? true,
      notifyCustomerOnCompleted: settings?.notifyCustomerOnCompleted ?? true,
      notifyCustomerOnRefunded: settings?.notifyCustomerOnRefunded ?? true,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/paystack/${templateId}`,
      stripeWebhookUrl: `${request.nextUrl.origin}/api/webhooks/stripe/commerce/${templateId}`,
    },
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, userId, role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const {
    enabled,
    currency,
    paymentProvider,
    paystackMode,
    paystackTestPublicKey,
    paystackTestSecretKey,
    paystackLivePublicKey,
    paystackLiveSecretKey,
    stripeMode,
    stripeTestPublishableKey,
    stripeTestSecretKey,
    stripeTestWebhookSecret,
    stripeLivePublishableKey,
    stripeLiveSecretKey,
    stripeLiveWebhookSecret,
    maildripApiKey,
    maildripPaidGroupId,
    maildripNewsletterGroupId,
    notificationEmail,
    storefrontSlug,
    notifyCustomerOnPaid,
    notifyCustomerOnProcessing,
    notifyCustomerOnReadyForPickup,
    notifyCustomerOnShipped,
    notifyCustomerOnCompleted,
    notifyCustomerOnRefunded,
  } = body;

  if (storefrontSlug !== undefined && typeof storefrontSlug !== "string") {
    return NextResponse.json({ error: "storefrontSlug must be a string." }, { status: 400 });
  }

  if (paystackMode !== undefined && paystackMode !== "TEST" && paystackMode !== "LIVE") {
    return NextResponse.json({ error: "paystackMode must be TEST or LIVE." }, { status: 400 });
  }
  if (stripeMode !== undefined && stripeMode !== "TEST" && stripeMode !== "LIVE") {
    return NextResponse.json({ error: "stripeMode must be TEST or LIVE." }, { status: 400 });
  }

  if (
    paymentProvider !== undefined &&
    paymentProvider !== "BYO_PAYSTACK" &&
    paymentProvider !== "PLATFORM_PAYSTACK" &&
    paymentProvider !== "PLATFORM_STRIPE" &&
    paymentProvider !== "BYO_STRIPE"
  ) {
    return NextResponse.json(
      { error: "paymentProvider must be BYO_PAYSTACK, PLATFORM_PAYSTACK, PLATFORM_STRIPE, or BYO_STRIPE." },
      { status: 400 },
    );
  }

  // Platform Stripe is admin-gated — see CommerceStripeAccessRequest and the
  // request/approval flow in app/api/v1/commerce/stripe-access/route.ts + plexo-admin.
  // Platform Paystack and BYO Stripe need no such gate — both are opt-in with either
  // Plexo's own Paystack account (automatic) or the site's own Stripe keys (entered below).
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

  let currencyWarning: string | null = null;
  if (currency !== undefined) {
    if (typeof currency !== "string" || !isKnownCurrency(currency)) {
      return NextResponse.json({ error: "That currency isn't supported yet." }, { status: 400 });
    }
    const { data: existingForCurrencyCheck } = await CommerceSettings.get({ templateId }).go();
    const currentCurrency = existingForCurrencyCheck?.currency ?? "NGN";
    if (currency.toUpperCase() !== currentCurrency.toUpperCase()) {
      // Changing currency after orders exist would silently corrupt every past order's
      // meaning (an amountMinor of 5000 means something completely different under NGN vs
      // USD) — this is a cheap, worthwhile guard even though it can't protect
      // CommerceProduct/CommerceDeliveryMethod prices already entered under the old currency.
      const { data: existingOrders } = await CommerceOrder.query.primary({ templateId }).go({ pages: 1 });
      if (existingOrders.length > 0) {
        return NextResponse.json(
          { error: "Can't change currency after orders exist — existing prices were entered in the current currency and won't be converted." },
          { status: 400 },
        );
      }
    }
    // Paystack's currency support is per-merchant-account and unverifiable from here — this
    // is a heads-up, not a hard block. The real backstop is Paystack's own API rejecting the
    // charge at checkout time (see lib/paystack.ts / the checkout routes' error surfacing).
    const effectiveProvider = paymentProvider ?? existingForCurrencyCheck?.paymentProvider ?? "BYO_PAYSTACK";
    if (
      (effectiveProvider === "BYO_PAYSTACK" || effectiveProvider === "PLATFORM_PAYSTACK") &&
      !isPaystackCompatibleCurrency(currency)
    ) {
      currencyWarning = `Paystack may not support charging in ${currency.toUpperCase()} for every merchant account — this depends on your Paystack account's own configuration and can't be verified from here.`;
    }
  }

  const data: Record<string, unknown> = {};
  type RemovableField =
    | "paystackTestPublicKey"
    | "paystackLivePublicKey"
    | "stripeTestPublishableKey"
    | "stripeLivePublishableKey"
    | "maildripPaidGroupId"
    | "maildripNewsletterGroupId"
    | "notificationEmail";
  const toRemove: RemovableField[] = [];

  if (typeof enabled === "boolean") data.enabled = enabled;
  if (typeof currency === "string") data.currency = currency.toUpperCase();
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
  // the form round-tripped a masked placeholder. Same contract for every secret below.
  if (typeof paystackTestSecretKey === "string" && paystackTestSecretKey) {
    data.paystackTestSecretKeyEncrypted = encryptPaystackKey(paystackTestSecretKey);
  }
  if (typeof paystackLiveSecretKey === "string" && paystackLiveSecretKey) {
    data.paystackLiveSecretKeyEncrypted = encryptPaystackKey(paystackLiveSecretKey);
  }
  if (stripeMode !== undefined) data.stripeMode = stripeMode;
  if (typeof stripeTestPublishableKey === "string") {
    if (stripeTestPublishableKey) data.stripeTestPublishableKey = stripeTestPublishableKey;
    else toRemove.push("stripeTestPublishableKey");
  }
  if (typeof stripeLivePublishableKey === "string") {
    if (stripeLivePublishableKey) data.stripeLivePublishableKey = stripeLivePublishableKey;
    else toRemove.push("stripeLivePublishableKey");
  }
  if (typeof stripeTestSecretKey === "string" && stripeTestSecretKey) {
    data.stripeTestSecretKeyEncrypted = encryptStripeKey(stripeTestSecretKey);
  }
  if (typeof stripeLiveSecretKey === "string" && stripeLiveSecretKey) {
    data.stripeLiveSecretKeyEncrypted = encryptStripeKey(stripeLiveSecretKey);
  }
  if (typeof stripeTestWebhookSecret === "string" && stripeTestWebhookSecret) {
    data.stripeTestWebhookSecretEncrypted = encryptStripeKey(stripeTestWebhookSecret);
  }
  if (typeof stripeLiveWebhookSecret === "string" && stripeLiveWebhookSecret) {
    data.stripeLiveWebhookSecretEncrypted = encryptStripeKey(stripeLiveWebhookSecret);
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
  if (typeof notifyCustomerOnPaid === "boolean") data.notifyCustomerOnPaid = notifyCustomerOnPaid;
  if (typeof notifyCustomerOnProcessing === "boolean") data.notifyCustomerOnProcessing = notifyCustomerOnProcessing;
  if (typeof notifyCustomerOnReadyForPickup === "boolean") data.notifyCustomerOnReadyForPickup = notifyCustomerOnReadyForPickup;
  if (typeof notifyCustomerOnShipped === "boolean") data.notifyCustomerOnShipped = notifyCustomerOnShipped;
  if (typeof notifyCustomerOnCompleted === "boolean") data.notifyCustomerOnCompleted = notifyCustomerOnCompleted;
  if (typeof notifyCustomerOnRefunded === "boolean") data.notifyCustomerOnRefunded = notifyCustomerOnRefunded;

  const { data: existing } = await CommerceSettings.get({ templateId }).go();
  if (existing) {
    let patch = CommerceSettings.patch({ templateId }).set(data);
    if (toRemove.length) patch = patch.remove(toRemove);
    await patch.go();
  } else {
    await CommerceSettings.create({ id: randomUUID(), templateId, organizationId, ...data }).go();
  }

  // Auto-provision the starter product page the moment Commerce is (or becomes) enabled —
  // a site owner shouldn't have to make a "design a product page" decision before selling
  // anything; ensureProductDetailLayout is idempotent, so this is a no-op once one's
  // attached (whether auto-created here before, or deliberately designed/reused).
  const effectiveEnabled = typeof enabled === "boolean" ? enabled : (existing?.enabled ?? false);
  let storefrontWarning: string | null = null;
  if (effectiveEnabled) {
    await ensureProductDetailLayout(templateId, organizationId, userId);
    await ensureStorefrontLayout(templateId, organizationId, userId);
  }
  if (typeof storefrontSlug === "string" && storefrontSlug.trim()) {
    if (!effectiveEnabled) {
      return NextResponse.json({ error: "Enable Commerce before renaming the storefront." }, { status: 400 });
    }
    try {
      await renameStorefrontSlug(templateId, storefrontSlug.trim());
    } catch (err) {
      storefrontWarning = err instanceof Error ? err.message : "Failed to rename the storefront.";
    }
  }

  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings) throw new Error(`CommerceSettings for template ${templateId} vanished immediately after being saved`);
  const resolvedStorefrontSlug = await getStorefrontSlug(templateId);

  return NextResponse.json({
    settings: {
      enabled: settings.enabled,
      storefrontSlug: resolvedStorefrontSlug,
      currency: settings.currency ?? "NGN",
      paymentProvider: settings.paymentProvider,
      paystackMode: settings.paystackMode,
      paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
      paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
      paystackTestSecretKeyMasked: settings.paystackTestSecretKeyEncrypted ? maskSecret(tryDecrypt(() => decryptPaystackKey(settings.paystackTestSecretKeyEncrypted!))) : null,
      paystackLiveSecretKeyMasked: settings.paystackLiveSecretKeyEncrypted ? maskSecret(tryDecrypt(() => decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted!))) : null,
      stripeMode: settings.stripeMode ?? "TEST",
      stripeTestPublishableKey: settings.stripeTestPublishableKey ?? null,
      stripeLivePublishableKey: settings.stripeLivePublishableKey ?? null,
      stripeTestSecretKeyMasked: settings.stripeTestSecretKeyEncrypted ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeTestSecretKeyEncrypted!))) : null,
      stripeLiveSecretKeyMasked: settings.stripeLiveSecretKeyEncrypted ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeLiveSecretKeyEncrypted!))) : null,
      stripeTestWebhookSecretMasked: settings.stripeTestWebhookSecretEncrypted ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeTestWebhookSecretEncrypted!))) : null,
      stripeLiveWebhookSecretMasked: settings.stripeLiveWebhookSecretEncrypted ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeLiveWebhookSecretEncrypted!))) : null,
      maildripApiKeyMasked: settings.maildripApiKeyEncrypted ? maskSecret(tryDecrypt(() => decryptMaildripKey(settings.maildripApiKeyEncrypted!))) : null,
      maildripPaidGroupId: settings.maildripPaidGroupId ?? null,
      maildripNewsletterGroupId: settings.maildripNewsletterGroupId ?? null,
      notificationEmail: settings.notificationEmail ?? null,
      notifyCustomerOnPaid: settings.notifyCustomerOnPaid ?? true,
      notifyCustomerOnProcessing: settings.notifyCustomerOnProcessing ?? true,
      notifyCustomerOnReadyForPickup: settings.notifyCustomerOnReadyForPickup ?? true,
      notifyCustomerOnShipped: settings.notifyCustomerOnShipped ?? true,
      notifyCustomerOnCompleted: settings.notifyCustomerOnCompleted ?? true,
      notifyCustomerOnRefunded: settings.notifyCustomerOnRefunded ?? true,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/paystack/${templateId}`,
      stripeWebhookUrl: `${request.nextUrl.origin}/api/webhooks/stripe/commerce/${templateId}`,
    },
    ...(currencyWarning || storefrontWarning ? { warning: [currencyWarning, storefrontWarning].filter(Boolean).join(" ") } : {}),
  });
}
