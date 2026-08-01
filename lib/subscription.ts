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
    customDomainEnabled: false,
    brandingRemovalEnabled: false,
    whiteLabelEnabled: false,
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
    customDomainEnabled: true,
    brandingRemovalEnabled: true,
    whiteLabelEnabled: true,
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
    customDomainEnabled: true,
    brandingRemovalEnabled: true,
    whiteLabelEnabled: true,
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

/**
 * Billing lives entirely on User today (subscriptionPlan, stripeCustomerId, etc.) — there
 * is no plan column on Organization. This resolves an org's effective plan by joining to
 * whichever Member has role "owner" and reading *their* subscriptionPlan, rather than
 * denormalizing plan onto Organization (a much larger change touching the Stripe webhook,
 * checkout flow, and credit ledger — see the white-labeling plan's notes on this). Use
 * this anywhere a feature needs to gate on "does this organization's plan allow X".
 */
export async function getOrganizationOwnerPlan(organizationId: string): Promise<SubscriptionPlan> {
  const { prisma } = await import("@/server/prisma");
  const owner = await prisma.member.findFirst({
    where: { organizationId, role: "owner" },
    select: { user: { select: { subscriptionPlan: true } } },
  });
  return (owner?.user.subscriptionPlan as SubscriptionPlan | undefined) ?? "FREE";
}

/**
 * Resolves the white-label identity for an organization — dashboard chrome
 * (dashboard-shell-{modern,classic}.tsx), transactional emails (lib/mail/templates.ts),
 * and the SDK-facing /api/v1/validate-key response all call this. Returns undefined if
 * the org isn't entitled (or has set no branding), in which case callers fall back to the
 * default Plexo identity.
 */
export async function getOrgBrand(
  organizationId: string,
): Promise<{ name: string; logoUrl?: string; color?: string } | undefined> {
  const { prisma } = await import("@/server/prisma");
  const plan = await getOrganizationOwnerPlan(organizationId);
  if (!canWhiteLabel(plan)) return undefined;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, logo: true, brandColor: true },
  });
  if (!org) return undefined;
  return { name: org.name, logoUrl: org.logo ?? undefined, color: org.brandColor ?? undefined };
}
