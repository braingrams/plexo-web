import type { CommercePaymentProvider } from "@/lib/db/commerceEntities";
import { resolveCheckoutPaystackSecret } from "@/lib/commerce/paystack";
import { resolveCheckoutStripeSecret } from "@/lib/commerce/stripe";

/**
 * Which way a checkout gets paid — shared by both checkout routes. A store can offer the
 * card gateway, direct bank transfer, or both; a store with only bank details (no gateway
 * keys at all) is still a working store. `requested` is what the customer picked at
 * checkout; absent (an older cached widget) falls back to whichever is available,
 * gateway first.
 */
export type CheckoutPaymentChoice = { method: "ONLINE" | "BANK_TRANSFER" } | { error: string };

export function chooseCheckoutPaymentMethod(requested: unknown, gatewayReady: boolean, bankTransferReady: boolean): CheckoutPaymentChoice {
  if (!gatewayReady && !bankTransferReady) {
    return { error: "This store isn't accepting payments yet — please check back soon or contact the seller." };
  }
  if (requested === "BANK_TRANSFER") {
    return bankTransferReady ? { method: "BANK_TRANSFER" } : { error: "Bank transfer isn't available for this store — please pay online instead." };
  }
  if (requested === "ONLINE") {
    return gatewayReady ? { method: "ONLINE" } : { error: "Online payment isn't available for this store — please choose bank transfer." };
  }
  return { method: gatewayReady ? "ONLINE" : "BANK_TRANSFER" };
}

/** Whether the site's selected card gateway has the keys it needs to actually charge —
 * the same test both checkout routes apply, for places (the storefront's checkout config)
 * that only need the yes/no, not the keys themselves. */
export function isGatewayReady(settings: {
  paymentProvider?: string | null;
  paystackMode?: "TEST" | "LIVE" | null;
  paystackTestPublicKey?: string | null;
  paystackTestSecretKeyEncrypted?: string | null;
  paystackLivePublicKey?: string | null;
  paystackLiveSecretKeyEncrypted?: string | null;
  stripeMode?: "TEST" | "LIVE" | null;
  stripeTestPublishableKey?: string | null;
  stripeTestSecretKeyEncrypted?: string | null;
  stripeTestWebhookSecretEncrypted?: string | null;
  stripeLivePublishableKey?: string | null;
  stripeLiveSecretKeyEncrypted?: string | null;
  stripeLiveWebhookSecretEncrypted?: string | null;
}): boolean {
  const provider = (settings.paymentProvider ?? "BYO_PAYSTACK") as CommercePaymentProvider;
  if (provider === "PLATFORM_STRIPE" || provider === "BYO_STRIPE") {
    return Boolean(
      resolveCheckoutStripeSecret({
        paymentProvider: provider,
        stripeMode: settings.stripeMode ?? "TEST",
        stripeTestPublishableKey: settings.stripeTestPublishableKey ?? null,
        stripeTestSecretKeyEncrypted: settings.stripeTestSecretKeyEncrypted ?? null,
        stripeTestWebhookSecretEncrypted: settings.stripeTestWebhookSecretEncrypted ?? null,
        stripeLivePublishableKey: settings.stripeLivePublishableKey ?? null,
        stripeLiveSecretKeyEncrypted: settings.stripeLiveSecretKeyEncrypted ?? null,
        stripeLiveWebhookSecretEncrypted: settings.stripeLiveWebhookSecretEncrypted ?? null,
      })?.secretKeyEncrypted,
    );
  }
  const keys = resolveCheckoutPaystackSecret({
    paymentProvider: provider,
    paystackMode: settings.paystackMode ?? "TEST",
    paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
    paystackTestSecretKeyEncrypted: settings.paystackTestSecretKeyEncrypted ?? null,
    paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
    paystackLiveSecretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted ?? null,
  });
  return Boolean(keys?.secretKeyEncrypted && keys.publicKey);
}
