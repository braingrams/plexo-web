/**
 * Best-effort scrub of SOL prompt/response text before it's written to
 * SolUsageEventContent (lib/db/opsEntities.ts) — see lib/solAnalytics.ts's
 * recordSolUsageEvent, the one caller. This is NOT a security control: it's a lightweight,
 * regex-based pass meant to reduce the odds of an email, phone number, or obviously
 * key/token-shaped string ending up readable in an analytics preview that a
 * SUPERADMIN/SUPPORT admin might later view (plexo-admin's
 * app/(dashboard)/sol/conversations/[id]). It will miss things (novel token formats, PII
 * embedded in ordinary prose with no recognizable shape) and can over-match (a long order
 * or reference number). Callers should treat these previews as "reduced risk," never as
 * "safe to show anyone" — the real, unredacted transcript always lives in
 * SolMessage/SolConversation (lib/db/solEntities.ts), gated separately.
 */
export function redact(text: string): string {
  if (!text) return text;

  let result = text;

  // "Authorization: Bearer <token>"-shaped strings pasted into a prompt.
  result = result.replace(/\bBearer\s+[A-Za-z0-9\-_.=]{8,}/gi, "[redacted]");

  // Provider-style API keys with a recognizable prefix (OpenAI/Anthropic/Stripe-style
  // sk-/pk-/rk- conventions, live or test).
  result = result.replace(/\b(?:sk|pk|rk)[-_](?:live|test)[-_][A-Za-z0-9]{8,}\b/gi, "[redacted]");
  result = result.replace(/\bsk-[A-Za-z0-9]{10,}\b/g, "[redacted]");

  // Long, high-entropy-looking base64/hex runs — generic bearer tokens, API keys without a
  // recognizable prefix, hashes. 24+ unbroken token-safe characters is long enough that
  // ordinary prose essentially never produces one by accident.
  result = result.replace(/\b[A-Za-z0-9+/_=-]{24,}\b/g, "[redacted]");

  // Email addresses.
  result = result.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[redacted]");

  // Phone numbers — a run of digits (optionally grouped with spaces/dashes/dots/parens,
  // optional leading "+") with at least 7 actual digits. Deliberately broad: an occasional
  // false positive (a long order number) is an acceptable cost for a best-effort analytics
  // scrub, not worth tuning further.
  result = result.replace(/\+?\d[\d().\-\s]{6,}\d/g, (match) => (match.replace(/\D/g, "").length >= 7 ? "[redacted]" : match));

  return result;
}
