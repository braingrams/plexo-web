import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Plexo's own "are you a person?" check, on every form by default. Nothing for the owner to sign up for or set up, and nothing for the
 * visitor to tick.
 *
 * When a page with a form loads, the page asks for a small signed ticket for that site. The form carries it along when it is sent. The
 * ticket only counts if it is genuine (signed by us, for this site), at least a few seconds old (nobody fills in a form in under three
 * seconds) and not older than two hours. A script posting straight to the form has no ticket, and one that fetches a ticket still has
 * to wait. The owner's own verification box (Turnstile, reCAPTCHA, hCaptcha) stays available on top of this.
 */

export const HUMAN_CHECK_FIELD = "_plx_check";
export const MIN_AGE_MS = 3_000;
export const MAX_AGE_MS = 2 * 60 * 60 * 1000;

const secret = (): string => process.env.FORM_CHECK_SECRET || process.env.AI_KEY_ENCRYPTION_SECRET || process.env.AUTH_SECRET || "plexo-form-check-dev";
const b64 = (s: Buffer | string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", secret()).update(`form-check:${body}`).digest("base64url");

/** A ticket for one site, stamped now (or at `issuedAt`, for tests). */
export function issueHumanCheck(templateId: string, issuedAt = Date.now()): string {
  const body = b64(JSON.stringify({ s: templateId, t: issuedAt, n: randomBytes(6).toString("hex") }));
  return `v1.${body}.${sign(body)}`;
}

export type HumanCheckResult = "ok" | "missing" | "invalid" | "too-fast" | "expired";

export function verifyHumanCheck(token: unknown, templateId: string, now = Date.now()): HumanCheckResult {
  if (typeof token !== "string" || !token) return "missing";
  const [v, body, sig] = token.split(".");
  if (v !== "v1" || !body || !sig) return "invalid";
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "invalid";
  let payload: { s?: unknown; t?: unknown };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return "invalid";
  }
  if (payload.s !== templateId || typeof payload.t !== "number") return "invalid";
  const age = now - payload.t;
  if (age < MIN_AGE_MS) return "too-fast";
  if (age > MAX_AGE_MS) return "expired";
  return "ok";
}

/** What to tell a real person whose check didn't pass. Plain words: they only need to wait a moment, or reload. */
export const humanCheckMessage = (r: HumanCheckResult): string =>
  r === "too-fast" ? "That was very quick. Please wait a moment and send it again." : "We couldn't confirm you're a person. Please reload the page and send it again.";
