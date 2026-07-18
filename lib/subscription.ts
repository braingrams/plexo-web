/**
 * Plexo Subscription Tier System
 *
 * Tiers: FREE → PRO → ULTRA
 * All users currently default to ULTRA (premium access for everyone).
 * This module defines the feature gates per tier so that when you assign
 * a plan to a user, the SDK and API will automatically enforce the right limits.
 */

export type SubscriptionPlan = "FREE" | "PRO" | "ULTRA";

export type TierFeatures = {
  /** Maximum number of templates the user can create */
  maxTemplates: number;
  /** Whether AI layout editing is allowed */
  aiEnabled: boolean;
  /** Maximum AI requests per day (-1 = unlimited) */
  aiRequestsPerDay: number;
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
};

const TIER_DEFINITIONS: Record<SubscriptionPlan, TierFeatures> = {
  FREE: {
    maxTemplates: 3,
    aiEnabled: false,
    aiRequestsPerDay: 0,
    compileApiEnabled: false,
    landingPagesEnabled: false,
    strataEnabled: false,
    maxApiKeys: 1,
    sdkAiTier: "BASIC",
  },
  PRO: {
    maxTemplates: 20,
    aiEnabled: true,
    aiRequestsPerDay: 50,
    compileApiEnabled: true,
    landingPagesEnabled: true,
    strataEnabled: true,
    maxApiKeys: 3,
    sdkAiTier: "MEDIUM",
  },
  ULTRA: {
    maxTemplates: -1, // unlimited
    aiEnabled: true,
    aiRequestsPerDay: -1, // unlimited
    compileApiEnabled: true,
    landingPagesEnabled: true,
    strataEnabled: true,
    maxApiKeys: 10,
    sdkAiTier: "HIGH",
  },
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
