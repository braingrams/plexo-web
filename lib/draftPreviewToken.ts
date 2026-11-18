import { createHmac, timingSafeEqual } from "node:crypto";

// A short-lived, signed address for ONE page's draft preview (GET /api/v1/templates/[id]/draft-preview), so
// Plexo's own browser (lambda/browser, which has no sign-in) can look at a page that isn't online yet.
// The token is `?sig=<hmac>&exp=<unix seconds>` (+ `shot=1` when it is a screenshot capture). It covers the
// site id, the page, the screenshot flag and the expiry, so it can't be reused for another page, can't be
// stretched past 5 minutes, and only ever allows reading that page's draft HTML (served in a sandbox, no cookies).
// The signing key is derived from AUTH_SECRET (already loaded from SSM on every function that serves or
// builds pages, lib/ssmEnv.ts), with its own purpose label, so no new secret has to be configured.

export const DRAFT_PREVIEW_TTL_SECONDS = 300;

export type DraftPreviewClaim = { templateId: string; pageId?: string | null; shot?: boolean };

export function draftPreviewSecret(): string {
  const base = process.env.AUTH_SECRET;
  if (!base) throw new Error("AUTH_SECRET is not configured.");
  return createHmac("sha256", base).update("plexo:draft-preview:v1").digest("hex");
}

function sign(secret: string, claim: DraftPreviewClaim, exp: number): string {
  return createHmac("sha256", secret).update(["draft-preview", claim.templateId, claim.pageId ?? "", claim.shot ? "1" : "0", String(exp)].join("\n")).digest("hex");
}

export function mintDraftPreviewToken(claim: DraftPreviewClaim, opts: { secret?: string; now?: number; ttlSeconds?: number } = {}): { sig: string; exp: number } {
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + Math.min(opts.ttlSeconds ?? DRAFT_PREVIEW_TTL_SECONDS, DRAFT_PREVIEW_TTL_SECONDS);
  return { sig: sign(opts.secret ?? draftPreviewSecret(), claim, exp), exp };
}

export function verifyDraftPreviewToken(claim: DraftPreviewClaim, token: { sig?: string | null; exp?: string | number | null }, opts: { secret?: string; now?: number } = {}): boolean {
  try {
    const exp = Number(token.exp);
    if (!token.sig || !Number.isInteger(exp)) return false;
    const now = Math.floor((opts.now ?? Date.now()) / 1000);
    if (exp < now || exp > now + DRAFT_PREVIEW_TTL_SECONDS + 5) return false;
    const expected = Buffer.from(sign(opts.secret ?? draftPreviewSecret(), claim, exp), "hex");
    const given = Buffer.from(String(token.sig), "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}

/** The full public address the screenshot browser opens. `origin` is this deployment's own address. */
export function signedDraftPreviewUrl(origin: string, claim: DraftPreviewClaim, opts: { secret?: string; now?: number } = {}): string {
  const { sig, exp } = mintDraftPreviewToken(claim, opts);
  const q = new URLSearchParams();
  if (claim.pageId) q.set("page", claim.pageId);
  if (claim.shot) q.set("shot", "1");
  q.set("exp", String(exp));
  q.set("sig", sig);
  return `${origin.replace(/\/$/, "")}/api/v1/templates/${encodeURIComponent(claim.templateId)}/draft-preview?${q.toString()}`;
}
