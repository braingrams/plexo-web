import type { CommercePaymentProvider, CommerceStripeMode } from "@/lib/db/commerceEntities";

type StripeKeyFields = {
  stripeMode: CommerceStripeMode;
  stripeTestPublishableKey: string | null;
  stripeTestSecretKeyEncrypted: string | null;
  stripeTestWebhookSecretEncrypted: string | null;
  stripeLivePublishableKey: string | null;
  stripeLiveSecretKeyEncrypted: string | null;
  stripeLiveWebhookSecretEncrypted: string | null;
};

/**
 * The one place that decides which BYO Stripe credential pair is "active" — mirrors
 * lib/commerce/paystack.ts's resolveActivePaystackKeys exactly, same reasoning: every
 * checkout/webhook/settings-display call site goes through this instead of reading the
 * stripeTest-prefixed/stripeLive-prefixed fields directly.
 */
export function resolveActiveStripeKeys(
  settings: StripeKeyFields,
): { publishableKey: string | null; secretKeyEncrypted: string | null; webhookSecretEncrypted: string | null } {
  return resolveStripeKeysForMode(settings, settings.stripeMode);
}

export function resolveStripeKeysForMode(
  settings: Omit<StripeKeyFields, "stripeMode">,
  mode: CommerceStripeMode,
): { publishableKey: string | null; secretKeyEncrypted: string | null; webhookSecretEncrypted: string | null } {
  return mode === "LIVE"
    ? {
        publishableKey: settings.stripeLivePublishableKey,
        secretKeyEncrypted: settings.stripeLiveSecretKeyEncrypted,
        webhookSecretEncrypted: settings.stripeLiveWebhookSecretEncrypted,
      }
    : {
        publishableKey: settings.stripeTestPublishableKey,
        secretKeyEncrypted: settings.stripeTestSecretKeyEncrypted,
        webhookSecretEncrypted: settings.stripeTestWebhookSecretEncrypted,
      };
}

/**
 * Which Stripe credential a CHECKOUT should actually use — branches on
 * CommerceSettings.paymentProvider, mirroring resolveCheckoutPaystackSecret. PLATFORM_STRIPE
 * uses Plexo's own single ops-controlled key (PLATFORM_COMMERCE_STRIPE_SECRET_KEY, no
 * per-site test/live split) instead of anything stored on CommerceSettings — proceeds get
 * credited to the site's CommerceWallet by the platform webhook. BYO_STRIPE delegates to
 * resolveActiveStripeKeys — proceeds land directly in the site's own Stripe account, never
 * touching Plexo's ledger. Returns null for BYO_PAYSTACK/PLATFORM_PAYSTACK — neither uses
 * Stripe at all.
 */
export function resolveCheckoutStripeSecret(
  settings: StripeKeyFields & { paymentProvider: CommercePaymentProvider },
): { secretKeyEncrypted: string | null; publishableKey: string | null; isPlatform: boolean } | null {
  if (settings.paymentProvider === "PLATFORM_STRIPE") {
    return {
      secretKeyEncrypted: process.env.PLATFORM_COMMERCE_STRIPE_SECRET_KEY ?? null,
      // Public by design (same as any Stripe publishable key) — served straight to the
      // storefront so commerce.js can mount embedded Checkout client-side.
      publishableKey: process.env.PLATFORM_COMMERCE_STRIPE_PUBLISHABLE_KEY ?? null,
      isPlatform: true,
    };
  }
  if (settings.paymentProvider === "BYO_STRIPE") {
    const { secretKeyEncrypted, publishableKey } = resolveActiveStripeKeys(settings);
    return { secretKeyEncrypted, publishableKey, isPlatform: false };
  }
  return null;
}

/**
 * Both configured webhook secrets, each tagged with the mode they belong to — for
 * verifying an incoming BYO Stripe webhook's signature. Same "try both" reasoning as
 * listConfiguredPaystackSecretKeys: a site can flip stripeMode while a transaction from the
 * previously-active mode is still settling, or simply have both a Test and a Live Stripe
 * dashboard pointed at the same webhook URL.
 */
export function listConfiguredStripeWebhookSecrets(
  settings: StripeKeyFields,
): Array<{ mode: CommerceStripeMode; webhookSecretEncrypted: string }> {
  const pairs: Array<{ mode: CommerceStripeMode; webhookSecretEncrypted: string | null }> = [
    { mode: "TEST", webhookSecretEncrypted: settings.stripeTestWebhookSecretEncrypted },
    { mode: "LIVE", webhookSecretEncrypted: settings.stripeLiveWebhookSecretEncrypted },
  ];
  return pairs.filter((p): p is { mode: CommerceStripeMode; webhookSecretEncrypted: string } => Boolean(p.webhookSecretEncrypted));
}
