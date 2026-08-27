import type { CommercePaystackMode } from "@prisma/client";

type PaystackKeyFields = {
  paystackMode: CommercePaystackMode;
  paystackTestPublicKey: string | null;
  paystackTestSecretKeyEncrypted: string | null;
  paystackLivePublicKey: string | null;
  paystackLiveSecretKeyEncrypted: string | null;
};

/**
 * The one place that decides which Paystack credential pair is "active" — every checkout,
 * webhook, and settings-display call site goes through this instead of reading the
 * paystackTest-prefixed/paystackLive-prefixed fields directly, so there's exactly one spot
 * where a mode/key mismatch could hide. Switching CommerceSettings.paystackMode is the only
 * thing that should ever move real charges from test to live.
 */
export function resolveActivePaystackKeys(settings: PaystackKeyFields): { publicKey: string | null; secretKeyEncrypted: string | null } {
  return resolvePaystackKeysForMode(settings, settings.paystackMode);
}

/**
 * Same lookup, but for an EXPLICIT mode rather than whichever one is currently toggled
 * active — for the one place that must never follow the current toggle: refunding an order.
 * CommerceOrder.paystackMode is stamped from the org's settings at the moment it was
 * created, and a refund has to go back through that same account regardless of what the
 * site has since been switched to, or Paystack rejects it (or worse, targets the wrong
 * account entirely).
 */
export function resolvePaystackKeysForMode(
  settings: Omit<PaystackKeyFields, "paystackMode">,
  mode: CommercePaystackMode,
): { publicKey: string | null; secretKeyEncrypted: string | null } {
  return mode === "LIVE"
    ? { publicKey: settings.paystackLivePublicKey, secretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted }
    : { publicKey: settings.paystackTestPublicKey, secretKeyEncrypted: settings.paystackTestSecretKeyEncrypted };
}

/**
 * Both configured secret keys, each tagged with the mode it belongs to — for the one place
 * that genuinely needs both regardless of which mode is currently "active": verifying an
 * incoming webhook's signature. A site can flip paystackMode while a transaction from the
 * previously-active mode is still settling, or simply have both a test and a live Paystack
 * dashboard pointed at the same webhook URL — either way, the signature has to be checked
 * against whichever key actually signed it, not just whatever's currently toggled on.
 */
export function listConfiguredPaystackSecretKeys(
  settings: PaystackKeyFields,
): Array<{ mode: CommercePaystackMode; secretKeyEncrypted: string }> {
  const pairs: Array<{ mode: CommercePaystackMode; secretKeyEncrypted: string | null }> = [
    { mode: "TEST", secretKeyEncrypted: settings.paystackTestSecretKeyEncrypted },
    { mode: "LIVE", secretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted },
  ];
  return pairs.filter((p): p is { mode: CommercePaystackMode; secretKeyEncrypted: string } => Boolean(p.secretKeyEncrypted));
}
