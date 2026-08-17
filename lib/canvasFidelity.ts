/**
 * Resolves which canvas rendering engine an embedded builder should use for the current
 * account: `'compiled'` (the new iframe-based canvas showing the actual sanitized/compiled
 * output, see @charisol/plexo-sdk's canvas-rewrite project) or `'legacy'` (the existing
 * independent React-tree canvas). Everyone gets `'legacy'` unless explicitly allowlisted.
 *
 * Deliberately an env var, not a persisted DB column, subscription-plan gate, or
 * per-template toggle: this is the project's canary rollout ladder (internal -> volunteer
 * orgs -> 10% -> 50% -> 100%) -- an operational decision about how far a still-soaking
 * feature has been trusted, not an entitlement a paying account is owed or a preference an
 * end user should be able to flip for themselves. Widening or narrowing the rollout is
 * "edit an env var", not a schema migration or a code change.
 */

const ALLOWLIST_ENV_VAR = "PLEXO_CANVAS_FIDELITY_ALLOWLIST";

function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Parsed once per process, not per request -- env vars are fixed for the lifetime of a
// deployment; widening the rollout is a redeploy (or restart), same as any other env var.
const ALLOWLIST = parseAllowlist(process.env[ALLOWLIST_ENV_VAR]);

export type ResolvedCanvasFidelity = "legacy" | "compiled";

/**
 * `identifiers` should be every value that could plausibly appear on the allowlist for the
 * account being resolved (user id, email, organization id) -- matching ANY of them grants
 * `'compiled'`. Case-insensitive. Safe to pass `null`/`undefined` entries.
 */
export function resolveCanvasFidelity(identifiers: Array<string | null | undefined>): ResolvedCanvasFidelity {
  if (ALLOWLIST.size === 0) return "legacy";
  const isAllowed = identifiers.some((id) => !!id && ALLOWLIST.has(id.toLowerCase()));
  return isAllowed ? "compiled" : "legacy";
}
