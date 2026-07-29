/**
 * Plexo Subscription Tier System
 *
 * Tiers: FREE → PRO → ULTRA
 * This module defines the feature gates per tier so that when you assign
 * a plan to a user, the SDK and API will automatically enforce the right limits.
 */

export type SubscriptionPlan = "FREE" | "PRO" | "ULTRA";

export type TierFeatures = {
  /** Maximum number of templates the user can create */
  maxTemplates: number;
  /** Whether AI layout editing is allowed */
  aiEnabled: boolean;
  /** Whether the user can access the MJML compile API */
  compileApiEnabled: boolean;
  /** Whether the user can use landing page templates */
  landingPagesEnabled: boolean;
  /** Whether the user gets access to Strata design system components */
  strataEnabled: boolean;
  /** Maximum number of API keys the user can generate */
  maxApiKeys: number;
  /** SDK tier label passed as `aiTier` prop */
  sdkAiTier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
  /**
   * Whether the account may self-manage landing page publishing: embedded SDK builders
   * publish/run AI under this account by default with no per-account domain limit,
   * unless an end-user overrides it with their own Plexo API key.
   */
  manageLandingPagePublishingEnabled: boolean;
  /**
   * Whether the account may use Host-Managed AI access (an embedding host app
   * authorizes/bills its own end users for every AI action via a webhook,
   * instead of Plexo's own credit ledger — see lib/ai/hostAuthorization.ts).
   * Gated to Ultra: it hands a host app control over every AI request Plexo
   * would otherwise meter/bill itself, so it's a paid-tier trust boundary,
   * not just a convenience feature.
   */
  hostManagedAiEnabled: boolean;
  /**
   * Whether the account can turn a landing page into a multi-page site
   * (add sub-pages nested under it, e.g. /about, /blog/post-1). Gated to
   * Ultra: sub-pages are unlimited per site once enabled (maxTemplates only
   * counts root/home pages), so this is the actual scarcity control.
   */
  multiPageSitesEnabled: boolean;
};

const TIER_DEFINITIONS: Record<SubscriptionPlan, TierFeatures> = {
  FREE: {
    maxTemplates: 3,
    aiEnabled: false,
    compileApiEnabled: false,
    landingPagesEnabled: false,
    strataEnabled: false,
    maxApiKeys: 1,
    sdkAiTier: "BASIC",
    manageLandingPagePublishingEnabled: false,
    hostManagedAiEnabled: false,
    multiPageSitesEnabled: false,
  },
  PRO: {
    maxTemplates: 20,
    aiEnabled: true,
    compileApiEnabled: true,
    landingPagesEnabled: true,
    strataEnabled: true,
    maxApiKeys: 3,
    sdkAiTier: "MEDIUM",
    manageLandingPagePublishingEnabled: false,
    hostManagedAiEnabled: false,
    multiPageSitesEnabled: false,
  },
  ULTRA: {
    maxTemplates: -1, // unlimited
    aiEnabled: true,
    compileApiEnabled: true,
    landingPagesEnabled: true,
    strataEnabled: true,
    maxApiKeys: 10,
    sdkAiTier: "HIGH",
    manageLandingPagePublishingEnabled: true,
    hostManagedAiEnabled: true,
    multiPageSitesEnabled: true,
  },
};

/**
 * Monthly system-AI credit allowance per plan — granted lazily (see
 * `lib/credits/ledger.ts`'s `ensureCreditPeriod`) and reset (not rolled over)
 * each 30-day cycle. Only applies to accounts using system AI (no BYOK key
 * configured); BYOK accounts never touch credits. These are starting defaults —
 * tune alongside `lib/credits/pricing.ts`'s CREDIT_USD_VALUE before launch.
 *
 * ULTRA is intentionally a large-but-finite number, not unlimited — now that
 * system AI has a real dollar cost behind it, unbounded usage on a fixed
 * subscription price is a margin risk; usage beyond the allowance is a top-up.
 */
export const PLAN_MONTHLY_CREDITS: Record<SubscriptionPlan, number> = {
  FREE: 2_000,
  PRO: 20_000,
  ULTRA: 100_000,
};

/**
 * Returns the feature set for a given subscription plan.
 * Defaults to ULTRA for any unrecognised plan string (fail-open for beta).
 */
export function getTierFeatures(plan: string | null | undefined): TierFeatures {
  if (plan === "FREE" || plan === "PRO" || plan === "ULTRA") {
    return TIER_DEFINITIONS[plan];
  }
  // Default to ULTRA — all current users are on the free beta with full access
  return TIER_DEFINITIONS.ULTRA;
}

/**
 * Returns true if a user on the given plan is allowed to perform the action.
 */
export function canDo(
  plan: SubscriptionPlan | string | null | undefined,
  feature: keyof TierFeatures,
): boolean {
  const features = getTierFeatures(plan);
  const value = features[feature];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return true;
}

/**
 * Collapses the raw, persisted `User.manageLandingPagePublishing` column with the
 * account's current plan. Even if the column is `true` (e.g. stale after a plan
 * downgrade), the effective value is `false` unless the plan is Ultra-tier — every
 * route that reads this setting should call this instead of trusting the raw column.
 */
export function resolveManageLandingPagePublishing(
  plan: SubscriptionPlan | string | null | undefined,
  rawFlag: boolean | null | undefined,
): boolean {
  return !!rawFlag && canDo(plan, "manageLandingPagePublishingEnabled");
}

/**
 * Whether an account on the given plan may use Host-Managed AI access.
 * Enforced both where an ApiKey's aiAccessMode is saved (reject setting it to
 * HOST_MANAGED on a non-Ultra account) and at request time in
 * app/api/v1/ai/generate/route.ts (reject even if the column somehow still
 * says HOST_MANAGED, e.g. after a downgrade) — the request-time check is the
 * one that actually matters; the save-time check just gives a clearer error
 * earlier.
 */
export function canUseHostManagedAi(plan: SubscriptionPlan | string | null | undefined): boolean {
  return canDo(plan, "hostManagedAiEnabled");
}
