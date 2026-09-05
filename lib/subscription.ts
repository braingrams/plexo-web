/**
 * Plexo Subscription Tier System
 *
 * Tiers: FREE → PRO → ULTRA
 * This module defines the feature gates per tier so that when you assign
 * a plan to a user, the SDK and API will automatically enforce the right limits.
 */

export type SubscriptionPlan = "FREE" | "PRO" | "ULTRA";

export type TierFeatures = {
  /** Maximum number of email templates the user can create */
  maxEmailTemplates: number;
  /** Maximum number of landing pages the user can create */
  maxLandingPages: number;
  /** Whether AI layout editing is allowed */
  aiEnabled: boolean;
  /** Whether the user can access the MJML compile API */
  compileApiEnabled: boolean;
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
   * Ultra: sub-pages are unlimited per site once enabled (maxLandingPages
   * only counts root/home pages), so this is the actual scarcity control.
   */
  multiPageSitesEnabled: boolean;
  /** Whether the account may link a CUSTOM (non-plexopages.io) domain to a published page. */
  customDomainEnabled: boolean;
  /**
   * Whether the account may hide the "Hosted with Plexo" bar injected into BUILDER pages
   * served on the shared plexopages.io subdomain (see app/pub/[domain]/[[...slug]]/route.ts
   * and User.hideBranding).
   */
  brandingRemovalEnabled: boolean;
  /**
   * Whether the organization may set its own name/logo/color in place of the Plexo brand
   * across the dashboard, transactional emails, published-page favicon, and the embedded
   * SDK's splash screen (Organization.logo/brandColor). Distinct from
   * brandingRemovalEnabled: that hides the "Hosted with Plexo" bar; this replaces the
   * Plexo identity itself with the org's own.
   */
  whiteLabelEnabled: boolean;
  /**
   * Number of Funnel/LMS funnels included at this plan for free (see lib/lms/funnelSlots.ts).
   * Only Ultra ships one included funnel; every plan (including Ultra, beyond its one) can
   * still buy additional funnels as a recurring per-slot add-on regardless of this number —
   * this is the free allotment, not a hard cap.
   */
  includedFunnelSlots: number;
};

const TIER_DEFINITIONS: Record<SubscriptionPlan, TierFeatures> = {
  FREE: {
    maxEmailTemplates: 5,
    maxLandingPages: 5,
    // Free ships 10 monthly AI credits (PLAN_MONTHLY_CREDITS.FREE below) — hard-locking the
    // AI entry point here made those credits impossible to ever spend (a free user could
    // never even open the AI prompt box to try one). The real, already-enforced limit is
    // ensureCreditPeriod/chargeUsage in app/api/v1/ai/generate/route.ts rejecting a request
    // once the balance hits zero — that's the correct gate; this flag only controls whether
    // the entry point is visible at all, so it should track "has a credit allowance" (every
    // tier does), not "is a paid tier."
    aiEnabled: true,
    compileApiEnabled: false,
    strataEnabled: false,
    maxApiKeys: 1,
    sdkAiTier: "BASIC",
    manageLandingPagePublishingEnabled: false,
    hostManagedAiEnabled: false,
    multiPageSitesEnabled: false,
    customDomainEnabled: false,
    brandingRemovalEnabled: false,
    whiteLabelEnabled: false,
    includedFunnelSlots: 0,
  },
  PRO: {
    maxEmailTemplates: 25,
    maxLandingPages: 25,
    aiEnabled: true,
    compileApiEnabled: true,
    strataEnabled: true,
    maxApiKeys: 3,
    sdkAiTier: "MEDIUM",
    manageLandingPagePublishingEnabled: false,
    hostManagedAiEnabled: false,
    multiPageSitesEnabled: false,
    customDomainEnabled: true,
    brandingRemovalEnabled: true,
    whiteLabelEnabled: true,
    includedFunnelSlots: 0,
  },
  ULTRA: {
    maxEmailTemplates: 100,
    maxLandingPages: 100,
    aiEnabled: true,
    compileApiEnabled: true,
    strataEnabled: true,
    maxApiKeys: 10,
    sdkAiTier: "HIGH",
    manageLandingPagePublishingEnabled: true,
    hostManagedAiEnabled: true,
    multiPageSitesEnabled: true,
    customDomainEnabled: true,
    brandingRemovalEnabled: true,
    whiteLabelEnabled: true,
    includedFunnelSlots: 1,
  },
};

/**
 * Monthly system-AI credit allowance per plan — granted lazily (see
 * `lib/credits/ledger.ts`'s `ensureCreditPeriod`) and reset (not rolled over)
 * each 30-day cycle. Only applies to accounts using system AI (no BYOK key
 * configured); BYOK accounts never touch credits.
 *
 * Sized against `lib/credits/pricing.ts`'s CREDIT_USD_VALUE default of $0.001/credit
 * (1000 credits = $1): ULTRA's 5,000 credits = $5 of real AI cost at that rate.
 *
 * ULTRA is intentionally a large-but-finite number, not unlimited — now that
 * system AI has a real dollar cost behind it, unbounded usage on a fixed
 * subscription price is a margin risk; usage beyond the allowance is a top-up.
 */
export const PLAN_MONTHLY_CREDITS: Record<SubscriptionPlan, number> = {
  FREE: 10,
  PRO: 2_000,
  ULTRA: 5_000,
};

/**
 * Returns the feature set for a given subscription plan.
 * Defaults to FREE for any unrecognised plan string (fail-closed now that plans are billed).
 */
export function getTierFeatures(plan: string | null | undefined): TierFeatures {
  if (plan === "FREE" || plan === "PRO" || plan === "ULTRA") {
    return TIER_DEFINITIONS[plan];
  }
  return TIER_DEFINITIONS.FREE;
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

/**
 * Collapses the raw, persisted `User.hideBranding` column with the account's current plan —
 * same pattern as resolveManageLandingPagePublishing: even if the column is `true` (e.g. stale
 * after a downgrade from Pro/Ultra), the effective value is `false` unless the plan currently
 * entitles branding removal.
 */
export function resolveHideBranding(
  plan: SubscriptionPlan | string | null | undefined,
  rawFlag: boolean | null | undefined,
): boolean {
  return !!rawFlag && canDo(plan, "brandingRemovalEnabled");
}

/**
 * Whether an account on the given plan may white-label (set its own name/logo/color in
 * place of the Plexo brand). See TierFeatures.whiteLabelEnabled.
 */
export function canWhiteLabel(plan: SubscriptionPlan | string | null | undefined): boolean {
  return canDo(plan, "whiteLabelEnabled");
}

// getOrganizationOwnerPlan/getOrgBrand (Prisma-backed) were fully superseded by
// server/orgDynamo.ts's getOrganizationOwnerPlanDynamo/getOrgBrandDynamo — every real
// caller already used the Dynamo versions; these were dead code, removed with the rest of
// the Postgres/Prisma stack.
