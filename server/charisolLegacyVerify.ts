import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { hashPassword, verifyPassword } from "@better-auth/utils/password";

import { User } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";

/**
 * Charisol's "legacy login verification" callback — see docs/legacy-user-migration.md in the
 * Charisol Auth repo. The first time a pre-existing Plexo email+password user signs in
 * through Charisol, Cognito's migration trigger POSTs their email+password here; if we say
 * valid, that password becomes their Charisol password and Charisol hands Plexo back our own
 * user id as the `legacy_user_id` token claim (matched in server/charisolAccount.ts).
 *
 * Only Charisol may call this: every request is Ed25519-signed over
 * `${timestamp}.${exact raw body}`. Unsigned/badly-signed/stale requests get 401 BEFORE the
 * body is parsed or the DB touched. Anything past that gate answers 200 — bad credentials are
 * `{valid:false}`, since a non-2xx tells Charisol our endpoint is broken, not that the
 * password is wrong.
 */

const PUBLIC_KEY_URL = "https://developers.charisol.io/charisol-legacy-verifier-public-key.pem";
const KEY_TTL_MS = 60 * 60_000;
const KEY_FETCH_TIMEOUT_MS = 2_500;
const MAX_CLOCK_SKEW_SECONDS = 60;

const EMAIL_LIMIT = 10;
const EMAIL_WINDOW_MS = 15 * 60_000;
// The caller is Charisol's own infrastructure, so many real users share few source IPs — this
// is only a backstop against a runaway loop, not a per-user control (that's the email limit).
const IP_LIMIT = 600;
const IP_WINDOW_MS = 5 * 60_000;

let cachedKey: { key: KeyObject; expiresAt: number } | undefined;

/** Test hook — drops the cached Charisol public key. */
export function resetVerifierKeyCache(): void {
  cachedKey = undefined;
}

// Env override wins (rotation/emergency pin); otherwise fetched on first use and cached for an
// hour. Returns null — never throws — when no usable key exists, so the caller fails CLOSED.
async function getVerifierPublicKey(now: number): Promise<KeyObject | null> {
  const override = process.env.CHARISOL_VERIFIER_PUBLIC_KEY_PEM?.trim();
  if (override) {
    try {
      // Allow the PEM to be stored in a single-line env var with literal "\n" sequences.
      return createPublicKey(override.replace(/\\n/g, "\n"));
    } catch {
      return null;
    }
  }
  if (cachedKey && cachedKey.expiresAt > now) return cachedKey.key;
  try {
    const res = await fetch(PUBLIC_KEY_URL, { signal: AbortSignal.timeout(KEY_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const key = createPublicKey(await res.text());
    cachedKey = { key, expiresAt: now + KEY_TTL_MS };
    return key;
  } catch {
    return null;
  }
}

async function isFromCharisol(headers: Headers, rawBody: string): Promise<boolean> {
  const timestamp = headers.get("x-charisol-timestamp");
  const signature = headers.get("x-charisol-signature");
  if (!timestamp || !signature) return false;

  const ts = Number(timestamp);
  const now = Date.now();
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > MAX_CLOCK_SKEW_SECONDS) return false;

  const key = await getVerifierPublicKey(now);
  if (!key) return false; // fail closed
  try {
    return verify(null, Buffer.from(`${timestamp}.${rawBody}`), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// Verified against for unknown emails / hash-less accounts so a miss costs about what a hit
// does — keeps response time from telling Charisol's callers (or anyone replaying) which
// emails exist. Built lazily: hashing at module scope would run during `next build`.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("charisol-legacy-verify-dummy-password");
  return dummyHash;
}

export interface LegacyVerifyResult {
  status: number;
  body: Record<string, unknown>;
}

const INVALID: LegacyVerifyResult = { status: 200, body: { valid: false } };

export async function handleLegacyVerify(request: Request, rawBody: string): Promise<LegacyVerifyResult> {
  if (!(await isFromCharisol(request.headers, rawBody))) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  let payload: { mode?: unknown; email?: unknown; password?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const mode = payload.mode;
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if ((mode !== "password" && mode !== "lookup") || !email || (mode === "password" && !password)) {
    return { status: 400, body: { error: "Invalid request" } };
  }

  // Rate limit only after the caller is authenticated. Over the limit degrades to the same
  // {valid:false} a wrong password gets — a non-2xx would be read by Charisol as "broken".
  if (
    !(await checkCommerceRateLimit(`legacy-verify-ip:${clientIp(request)}`, IP_LIMIT, IP_WINDOW_MS)) ||
    !(await checkCommerceRateLimit(`legacy-verify:${email}`, EMAIL_LIMIT, EMAIL_WINDOW_MS))
  ) {
    return INVALID;
  }

  const { data: matches } = await User.query.byEmail({ email }).go();
  const user = matches[0];

  if (mode === "password") {
    // Always run exactly one hash comparison, hit or miss.
    const valid = await verifyPassword(user?.passwordHash || (await getDummyHash()), password).catch(() => false);
    if (!user || !user.passwordHash || !valid) return INVALID;
    // A password that is just the account's own email is derivable by anyone (older signups
    // could end up this way) — never carry it over into the shared Charisol account.
    if (password.trim().toLowerCase() === user.email.toLowerCase()) return INVALID;
  }

  if (!user) return INVALID;
  if (user.suspendedAt) return INVALID;
  // Only accounts whose owner has confirmed their email move to Charisol. An unconfirmed
  // account proves nothing about who owns the address (anyone can register any email), and
  // Charisol would create it as an unverified account that Plexo then refuses to sign in
  // forever. Plexo's own sign-in already tells an unconfirmed user to click their
  // confirmation link first; their next sign-in after that moves them across.
  if (!user.isConfirmed) return INVALID;

  const response: Record<string, unknown> = {
    valid: true,
    email: user.email.toLowerCase(),
    emailVerified: true,
    userId: user.id,
  };
  if (user.name) response.name = user.name;
  if (user.image) response.picture = user.image;
  return { status: 200, body: response };
}
