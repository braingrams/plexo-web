/**
 * Resolves which canvas rendering engine an embedded builder should use for the current
 * account: `'compiled'` (the iframe-based canvas showing the actual sanitized/compiled output,
 * see @charisol/plexo-sdk's canvas-rewrite project) or `'legacy'` (the previous independent
 * React-tree canvas). `'compiled'` is now the standard for everyone -- the canary rollout
 * (internal -> volunteer orgs -> 10% -> 50% -> 100%) is complete, following extensive fixture/
 * golden-snapshot coverage and live-browser verification against real production templates.
 *
 * The remaining env var is an emergency-only GLOBAL kill switch, not an opt-in allowlist: set
 * it if something breaks for real users post-launch and a full redeploy isn't fast enough to
 * revert, not as a day-to-day rollout lever. Deliberately still an env var, not a persisted DB
 * column or per-template toggle -- flipping it is "edit an env var, restart", not a schema
 * migration or a code change, same reasoning as the allowlist it replaces.
 */

const FORCE_LEGACY_ENV_VAR = "PLEXO_CANVAS_FIDELITY_FORCE_LEGACY";

function isForceLegacyEnabled(raw: string | undefined): boolean {
  const normalized = (raw ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

// Parsed once per process, not per request -- env vars are fixed for the lifetime of a
// deployment; flipping this is a redeploy (or restart), same as any other env var.
const FORCE_LEGACY = isForceLegacyEnabled(process.env[FORCE_LEGACY_ENV_VAR]);

export type ResolvedCanvasFidelity = "legacy" | "compiled";

/**
 * `identifiers` is accepted for call-site compatibility (existing callers already pass
 * session/apiKey user id, org id, email) but is no longer used for per-account gating --
 * everyone gets `'compiled'` unless the global kill switch above is set.
 */
export function resolveCanvasFidelity(_identifiers: Array<string | null | undefined>): ResolvedCanvasFidelity {
  return FORCE_LEGACY ? "legacy" : "compiled";
}
