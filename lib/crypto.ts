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
