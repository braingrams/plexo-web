import { createHmac, timingSafeEqual } from "node:crypto";

// Strata's signed webhooks (charisol-design-system-be utils/webhooks.js):
//   X-Strata-Timestamp: <unix seconds at this attempt>
//   X-Strata-Signature: v1=<lowercase hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
// The key is the whole secret string (including its "whsec_" prefix) as UTF-8. A delivery older or newer than the tolerance
// is refused, so a captured request can't be replayed later.

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function signStrataPayload(secret: string, timestamp: string | number, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export function verifyStrataSignature(input: { secret: string; timestamp: string | null; signature: string | null; rawBody: string; nowMs?: number }): SignatureCheck {
  const { secret, timestamp, signature, rawBody } = input;
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "missing" };
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const expected = Buffer.from(signStrataPayload(secret, timestamp, rawBody));
  // A header may carry several signatures (during a secret rotation): any one matching is enough.
  for (const part of signature.split(/[\s,]+/)) {
    const given = Buffer.from(part.trim());
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}
