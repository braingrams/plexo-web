import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

// Visitor passwords for apps built on Plexo. scrypt (memory-hard, built into Node — no native
// dependency to ship), stored self-describing so parameters can be raised later without
// invalidating existing hashes: scrypt$N$r$p$salt$hash.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const PARAMS = { N: 32768, r: 8, p: 1 };
const KEY_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, { ...PARAMS, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

// Verifying against this when no account exists keeps "wrong email" and "wrong password"
// equally slow, so response time doesn't reveal which emails have accounts.
let dummyHash: Promise<string> | null = null;

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const target = stored ?? (await (dummyHash ??= hashPassword(randomBytes(12).toString("hex"))));
  const parts = target.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && timingSafeEqual(actual, expected) && !!stored;
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) return "Use a password with at least 8 characters.";
  if (password.length > 200) return "That password is too long (200 characters at most).";
  if (/^(.)\1+$/.test(password) || COMMON.has(password.toLowerCase())) return "That password is too easy to guess — try a longer phrase.";
  return null;
}

const COMMON = new Set(["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop", "iloveyou", "11111111", "abc12345", "letmein1", "welcome1", "admin123"]);

/** Random, URL-safe secret for sessions and emailed links; only its hash is ever stored. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}
