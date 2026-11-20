import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  // Normalize any secret length into a 32-byte AES-256 key.
  return createHash("sha256").update(secret, "utf8").digest();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function encryptWithKey(plainText: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decryptWithKey(encoded: string, key: Buffer): string {
  const raw = Buffer.from(encoded, "base64");
  if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Value is too short to be a valid encrypted secret.");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Encrypts a secret (e.g. a BYOK provider API key) for storage at rest, keyed off
 * AI_KEY_ENCRYPTION_SECRET. Output: base64(iv || authTag || ciphertext).
 */
export function encryptSecret(plainText: string): string {
  return encryptWithKey(plainText, deriveKey(requireEnv("AI_KEY_ENCRYPTION_SECRET")));
}

/**
 * Decrypts a value produced by encryptSecret. Throws if the value is not a valid
 * ciphertext for the current key (wrong key, corrupted data, or a legacy plaintext
 * value) — callers use this to distinguish the two.
 */
export function decryptSecret(encoded: string): string {
  return decryptWithKey(encoded, deriveKey(requireEnv("AI_KEY_ENCRYPTION_SECRET")));
}

/**
 * Encrypts/decrypts WithdrawalRequest bank details (account number, holder name) — a
 * DELIBERATELY separate secret (BANK_DETAILS_ENCRYPTION_SECRET) from encryptSecret's
 * AI_KEY_ENCRYPTION_SECRET, so a leak of one never exposes the other. plexo-admin's copy
 * of this file only ever calls decryptBankDetail, using the same env var value.
 */
export function encryptBankDetail(plainText: string): string {
  return encryptWithKey(plainText, deriveKey(requireEnv("BANK_DETAILS_ENCRYPTION_SECRET")));
}

export function decryptBankDetail(encoded: string): string {
  return decryptWithKey(encoded, deriveKey(requireEnv("BANK_DETAILS_ENCRYPTION_SECRET")));
}

/**
 * Encrypts/decrypts a Commerce org's own Paystack secret key — another DELIBERATELY
 * separate secret (PAYSTACK_KEY_ENCRYPTION_SECRET), same isolation rationale as
 * encryptBankDetail: a leak of the AI-key or bank-detail secret must never expose a
 * customer's Paystack credentials, and vice versa.
 */
export function encryptPaystackKey(plainText: string): string {
  return encryptWithKey(plainText, deriveKey(requireEnv("PAYSTACK_KEY_ENCRYPTION_SECRET")));
}

export function decryptPaystackKey(encoded: string): string {
  return decryptWithKey(encoded, deriveKey(requireEnv("PAYSTACK_KEY_ENCRYPTION_SECRET")));
}

/**
 * Encrypts/decrypts a Commerce site's own BYO Stripe secrets — secret keys AND webhook
 * signing secrets both live here (a leak of either is equally sensitive), on another
 * DELIBERATELY separate secret (STRIPE_KEY_ENCRYPTION_SECRET), same isolation rationale
 * as encryptPaystackKey: a leak of any other secret in this file must never expose a
 * site owner's own Stripe credentials, and vice versa.
 */
export function encryptStripeKey(plainText: string): string {
  return encryptWithKey(plainText, deriveKey(requireEnv("STRIPE_KEY_ENCRYPTION_SECRET")));
}

export function decryptStripeKey(encoded: string): string {
  return decryptWithKey(encoded, deriveKey(requireEnv("STRIPE_KEY_ENCRYPTION_SECRET")));
}

/**
 * Encrypts/decrypts a Commerce site's own MailDrip API key — another DELIBERATELY separate
 * secret (MAILDRIP_KEY_ENCRYPTION_SECRET), same isolation rationale as the other three: a
 * leak of any one of these secrets must never expose what the others protect.
 */
export function encryptMaildripKey(plainText: string): string {
  return encryptWithKey(plainText, deriveKey(requireEnv("MAILDRIP_KEY_ENCRYPTION_SECRET")));
}

export function decryptMaildripKey(encoded: string): string {
  return decryptWithKey(encoded, deriveKey(requireEnv("MAILDRIP_KEY_ENCRYPTION_SECRET")));
}

/**
 * Encrypts/decrypts a digital product's optional ACCESS_LIST password
 * (CommerceProduct.digitalAccessPasswordEncrypted) — another DELIBERATELY separate secret
 * (COMMERCE_DIGITAL_ACCESS_ENCRYPTION_SECRET), same isolation rationale as the other four.
 */
export function encryptDigitalAccessSecret(plainText: string): string {
  return encryptWithKey(plainText, deriveKey(requireEnv("COMMERCE_DIGITAL_ACCESS_ENCRYPTION_SECRET")));
}

export function decryptDigitalAccessSecret(encoded: string): string {
  return decryptWithKey(encoded, deriveKey(requireEnv("COMMERCE_DIGITAL_ACCESS_ENCRYPTION_SECRET")));
}

/**
 * Encrypts/decrypts the secrets an app built on Plexo stores for its server functions
 * (AppSecret, and an app's own Google OAuth client secret) — another DELIBERATELY separate
 * secret (APP_SECRETS_ENCRYPTION_SECRET): these are third parties' keys (Stripe, OpenAI…)
 * belonging to app owners, isolated from every platform secret above.
 */
export function encryptAppSecret(plainText: string): string {
  return encryptWithKey(plainText, deriveKey(requireEnv("APP_SECRETS_ENCRYPTION_SECRET")));
}

export function decryptAppSecret(encoded: string): string {
  return decryptWithKey(encoded, deriveKey(requireEnv("APP_SECRETS_ENCRYPTION_SECRET")));
}

/**
 * Encrypts/decrypts a person's Strata session token (lib/strata/session.ts) — another
 * DELIBERATELY separate secret (STRATA_TOKEN_ENCRYPTION_SECRET): the token lets whoever
 * holds it act as that person in Strata, so a leak of any other secret in this file must
 * never expose it, and vice versa.
 */
export function encryptStrataToken(plainText: string): string {
  return encryptWithKey(plainText, deriveKey(requireEnv("STRATA_TOKEN_ENCRYPTION_SECRET")));
}

export function decryptStrataToken(encoded: string): string {
  return decryptWithKey(encoded, deriveKey(requireEnv("STRATA_TOKEN_ENCRYPTION_SECRET")));
}

/**
 * Encrypts/decrypts the Google refresh token a site owner grants so Plexo can read their
 * Google Analytics reports. Its own DELIBERATELY separate secret
 * (GOOGLE_ANALYTICS_TOKEN_ENCRYPTION_SECRET), same isolation rationale as the others above.
 */
export function encryptGoogleAnalyticsToken(plainText: string): string {
  return encryptWithKey(plainText, deriveKey(requireEnv("GOOGLE_ANALYTICS_TOKEN_ENCRYPTION_SECRET")));
}

export function decryptGoogleAnalyticsToken(encoded: string): string {
  return decryptWithKey(encoded, deriveKey(requireEnv("GOOGLE_ANALYTICS_TOKEN_ENCRYPTION_SECRET")));
}

/**
 * Wraps any of the decryptX functions above and turns a failure into `null` instead of
 * throwing — every decrypt* function here throws on a wrong/rotated key or corrupted
 * ciphertext (AES-GCM auth-tag mismatch), which is a REAL possibility for pre-existing
 * data if the encryption secret was ever rotated without re-encrypting stored values.
 * Callers that already treat "no value" as a valid, handled state (e.g. "this field was
 * never configured") should use this so a decrypt failure degrades to that same state —
 * prompting whoever owns the record to re-enter the secret — instead of crashing the
 * whole page/request.
 */
export function tryDecrypt(fn: () => string): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
