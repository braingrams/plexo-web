/**
 * Plexo plans and what each one includes — THE entitlement table.
 *
 * Plans: FREE → STARTER → PRO → ENTERPRISE (lib/plan/plans.ts; the old PRO/ULTRA map onto
 * STARTER/PRO). Prices live in lib/billing/pricing.ts; AI credit amounts in
 * lib/credits/value.ts. Every limit check reads getTierFeatures(plan) — never a plan name.
 */

import { PLAN_IDS, toPlanId, type PlanId } from "@/lib/plan/plans";

export type SubscriptionPlan = PlanId;

export type TierFeatures = {
  /** Maximum number of email templates the user can create */
  maxEmailTemplates: number;
  /** Maximum number of landing pages the user can create */
  maxLandingPages: number;
  /** Maximum number of PUBLISHED blog posts per site. `null` means unlimited. */
  maxPublishedBlogPosts: number | null;
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
   * Gated to Pro and Enterprise: it hands a host app control over every AI request Plexo
   * would otherwise meter/bill itself, so it's a paid-tier trust boundary,
   * not just a convenience feature.
   */
  hostManagedAiEnabled: boolean;
  /**
   * Pro and above. NOT a limit on building: every plan can add sub-pages and preview them
   * (so an owner sees the whole site before upgrading) — what Free cannot do is put them live,
   * which is maxPublishedPagesPerSite below. Today this only gates the bulk "import a whole
   * site" flows (lib/siteImport), which crawl and create many pages at once.
   */
  multiPageSitesEnabled: boolean;
  /**
   * Whether the account can move a whole existing site in (WordPress migration,
   * importing a site from another builder). Pro and above (Free is a single
   * page). Its own switch so the two can be gated separately again if ever needed.
   */
  siteMigrationEnabled: boolean;
  /** Paste your own code (site verification, pixels, chat widgets) into every page's header/footer. Starter and above, and only live on a custom domain. */
  customCodeEnabled: boolean;
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
   * Included funnels: Starter 1, Pro 3, Enterprise 10 (Free 0). Every plan can
   * still buy additional funnels as a recurring per-slot add-on regardless of this number —
   * this is the free allotment, not a hard cap.
   */
  includedFunnelSlots: number;
  /**
   * How many sites (landing pages and apps) can be LIVE at once — reachable at any address.
   * `null` = no cap beyond the published-domain limit. Free keeps one: on a downgrade the
   * most recently edited site stays up and the rest go offline (lib/plan/lifecycle.ts).
   */
  maxPublishedSites: number | null;
  /**
   * How many pages of one site are served. `1` = only the homepage — every other page,
   * the blog and the store send visitors back to the homepage (app/pub/[domain]) and an
   * app only answers its first screen (lib/projects/serve.ts). `null` = every page.
   */
  maxPublishedPagesPerSite: number | null;
  /**
   * Which hosting tiers are available for deployed framework apps (static zip deploys).
   * STATIC = S3-only, cheapest, no compute per request.
   * LAMBDA = Lambda on-demand, server-side rendering, cold starts possible.
   * PROVISIONED = Lambda with provisioned concurrency, no cold starts, fixed monthly cost.
   */
  deployedAppHostingTiers: ("STATIC" | "LAMBDA" | "PROVISIONED")[];
  /**
   * Maximum Lambda invocations per calendar day for a deployed framework app. STATIC-tier
   * requests served from CloudFront cache don't count (Lambda never runs). Enforced by
   * lib/pub/deployedAppRateLimit.ts — returns 429 once exceeded. `null` = no daily cap.
   */
  deployedAppDailyRequestLimit: number | null;
  /**
   * Server-rendered (SSR) apps: upload, build, publish, env vars, and serving. Pro and Enterprise.
   * Every SSR endpoint and the SSR serving paths check this flag.
   */
  ssrEnabled: boolean;
  /**
   * Monthly budget, in projected USD, for SSR builds. Each build reserves a fixed projected cost
   * (lib/projects/ssrBudget.ts), so the budget caps builds per month. 0 when SSR is off.
   */
  ssrMonthlyBudgetUsd: number;
  /** Whether the blog can be published (Free is homepage-only, so it has no blog). */
  blogEnabled: boolean;
  /** Whether Commerce (store, checkout) may take orders at all. */
  commerceEnabled: boolean;
  /**
   * Whether a store may use its OWN Stripe/Paystack keys (BYO_*). Without it, a store takes
   * payments through Plexo's own payment accounts (PLATFORM_*) only.
   */
  ownPaymentKeysEnabled: boolean;
  /** Whether a store may take real payments right now (off on Free and during the free trial). */
  livePaymentsEnabled: boolean;
  /** Most products one store can hold. 0 when Commerce is off. */
  maxCommerceProducts: number;
  /** How many custom (non-Plexo) domains can be connected. 0 = Plexo address only. */
  maxCustomDomains: number;
  /** Domains Plexo registers for free with the plan (Pro: 1, Enterprise: 1 .com). */
  includedFreeDomains: number;
  /** People who can be invited to the workspace besides its owner (pending invites count). */
  teamSeats: number;
  /** Download a site as HTML files. Entitlement only — the export itself isn't built yet. */
  htmlExportEnabled: boolean;
  /** Import an HTML page/site. */
  htmlImportEnabled: boolean;
  /** Visitor analytics for published sites. */
  analyticsEnabled: boolean;
  /** Connect AI assistants over MCP. */
  mcpEnabled: boolean;
  /** Use the Plexo SDK. */
  sdkEnabled: boolean;
  /** What support the plan comes with, in plain words. */
  supportLabel: "AI chat" | "Email" | "Email + call" | "Account manager";
};

// Shared by every paid plan — what the old PRO unlocked is unlocked by STARTER and above.
const PAID_BASE = {
  aiEnabled: true,
  compileApiEnabled: true,
  strataEnabled: true,
  multiPageSitesEnabled: true,
  siteMigrationEnabled: true,
  customDomainEnabled: true,
  brandingRemovalEnabled: true,
  maxPublishedPagesPerSite: null,
  blogEnabled: true,
  maxPublishedBlogPosts: null,
  commerceEnabled: true,
  livePaymentsEnabled: true,
  htmlExportEnabled: true,
  htmlImportEnabled: true,
  analyticsEnabled: true,
  mcpEnabled: true,
  sdkEnabled: true,
} as const;

const TIER_DEFINITIONS: Record<SubscriptionPlan, TierFeatures> = {
  FREE: {
    maxEmailTemplates: 1,
    maxLandingPages: 5,
    maxPublishedBlogPosts: 0,
    blogEnabled: false,
    // Free ships a small monthly AI allowance (lib/credits/value.ts) — hard-locking the
    // AI entry point here made those credits impossible to ever spend. The real limit is
    // the credit balance (ensureCreditPeriod/chargeUsage); this flag only controls whether
    // the entry point is visible at all.
    aiEnabled: true,
    compileApiEnabled: false,
    strataEnabled: false,
    maxApiKeys: 1,
    sdkAiTier: "BASIC",
    manageLandingPagePublishingEnabled: false,
    hostManagedAiEnabled: false,
    multiPageSitesEnabled: false,
    // Moving an existing site in is on every plan (what Free can PUBLISH is still the homepage).
    siteMigrationEnabled: true,
    customDomainEnabled: false,
    customCodeEnabled: false,
    maxCustomDomains: 0,
    includedFreeDomains: 0,
    brandingRemovalEnabled: false,
    whiteLabelEnabled: false,
    includedFunnelSlots: 0,
    maxPublishedSites: 1,
    maxPublishedPagesPerSite: 1,
    deployedAppHostingTiers: ["STATIC"],
    deployedAppDailyRequestLimit: 1_000,
    ssrEnabled: false,
    ssrMonthlyBudgetUsd: 0,
    commerceEnabled: false,
    livePaymentsEnabled: false,
    ownPaymentKeysEnabled: false,
    maxCommerceProducts: 0,
    teamSeats: 0,
    htmlExportEnabled: false,
    htmlImportEnabled: true,
    analyticsEnabled: false,
    mcpEnabled: true,
    sdkEnabled: true,
    supportLabel: "AI chat",
  },
  // Everything the old PRO plan had.
  STARTER: {
    ...PAID_BASE,
    maxEmailTemplates: 5,
    maxLandingPages: 25,
    maxApiKeys: 3,
    sdkAiTier: "MEDIUM",
    manageLandingPagePublishingEnabled: false,
    hostManagedAiEnabled: false,
    customCodeEnabled: true,
    maxCustomDomains: 1,
    includedFreeDomains: 0,
    whiteLabelEnabled: false,
    includedFunnelSlots: 1,
    maxPublishedSites: 1,
    deployedAppHostingTiers: ["STATIC", "LAMBDA"],
    deployedAppDailyRequestLimit: 100_000,
    ssrEnabled: false,
    ssrMonthlyBudgetUsd: 0,
    ownPaymentKeysEnabled: false,
    maxCommerceProducts: 1_000,
    teamSeats: 2,
    supportLabel: "Email",
  },
  // Everything the old ULTRA plan had (server apps, Plexo-hosted AI for the SDK, higher limits).
  PRO: {
    ...PAID_BASE,
    maxEmailTemplates: 20,
    maxLandingPages: 100,
    maxApiKeys: 10,
    sdkAiTier: "HIGH",
    manageLandingPagePublishingEnabled: true,
    hostManagedAiEnabled: true,
    customCodeEnabled: true,
    maxCustomDomains: 3,
    includedFreeDomains: 1,
    whiteLabelEnabled: false,
    includedFunnelSlots: 3,
    maxPublishedSites: 4,
    deployedAppHostingTiers: ["STATIC", "LAMBDA", "PROVISIONED"],
    deployedAppDailyRequestLimit: null,
    ssrEnabled: true,
    ssrMonthlyBudgetUsd: 6,
    ownPaymentKeysEnabled: true,
    maxCommerceProducts: 5_000,
    teamSeats: 5,
    supportLabel: "Email + call",
  },
  // Everything in PRO and more. "Custom" limits in the price list are generous defaults here;
  // an account can be raised further from the admin console (custom domain limit) on request.
  ENTERPRISE: {
    ...PAID_BASE,
    maxEmailTemplates: 100,
    maxLandingPages: 500,
    maxApiKeys: 25,
    sdkAiTier: "HIGH",
    manageLandingPagePublishingEnabled: true,
    hostManagedAiEnabled: true,
    customCodeEnabled: true,
    maxCustomDomains: 10,
    includedFreeDomains: 1,
    whiteLabelEnabled: true,
    includedFunnelSlots: 10,
    maxPublishedSites: null,
    deployedAppHostingTiers: ["STATIC", "LAMBDA", "PROVISIONED"],
    deployedAppDailyRequestLimit: null,
    ssrEnabled: true,
    ssrMonthlyBudgetUsd: 30,
    ownPaymentKeysEnabled: true,
    maxCommerceProducts: 10_000,
    teamSeats: 25,
    supportLabel: "Account manager",
  },
};

/** What the 14-day trial holds back until the first payment: no custom domains, no live payments, no white-label. */
const TRIAL_WITHHELD: Partial<TierFeatures> = {
  customDomainEnabled: false,
  maxCustomDomains: 0,
  includedFreeDomains: 0,
  whiteLabelEnabled: false,
  livePaymentsEnabled: false,
};

// Monthly AI credit allowances are derived from each plan's AI dollar value in
// lib/credits/value.ts (planMonthlyCredits) — the single reference for credit amounts.

/**
 * Returns the feature set for a plan. Accepts today's ids and the retired ULTRA (= PRO);
 * anything unrecognised gets FREE (fail closed). Every plan id has an entry — the table is
 * exhaustive by type. Pass `{ trial: true }` for an account on its free trial.
 */
export function getTierFeatures(plan: string | null | undefined, opts: { trial?: boolean } = {}): TierFeatures {
  const features = TIER_DEFINITIONS[toPlanId(plan)];
  return opts.trial ? { ...features, ...TRIAL_WITHHELD } : features;
}

/** The whole table, for pricing pages and the admin console. */
export function allTierFeatures(): Record<SubscriptionPlan, TierFeatures> {
  return Object.fromEntries(PLAN_IDS.map((p) => [p, TIER_DEFINITIONS[p]])) as Record<SubscriptionPlan, TierFeatures>;
}

/** True when only a site's homepage may be served on this plan (Free). */
export function isHomePageOnlyPlan(plan: string | null | undefined): boolean {
  return getTierFeatures(plan).maxPublishedPagesPerSite === 1;
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
 * downgrade), the effective value is `false` unless the plan is Pro-tier or above — every
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
 * HOST_MANAGED on a non-Pro account) and at request time in
 * app/api/v1/ai/generate/route.ts (reject even if the column somehow still
 * says HOST_MANAGED, e.g. after a downgrade) — the request-time check is the
 * one that actually matters; the save-time check just gives a clearer error
 * earlier.
 */
export function canUseHostManagedAi(
  plan: SubscriptionPlan | string | null | undefined,
): boolean {
  return canDo(plan, "hostManagedAiEnabled");
}

/**
 * Collapses the raw, persisted `User.hideBranding` column with the account's current plan —
 * same pattern as resolveManageLandingPagePublishing: even if the column is `true` (e.g. stale
 * after a downgrade from Pro or Enterprise), the effective value is `false` unless the plan currently
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
export function canWhiteLabel(
  plan: SubscriptionPlan | string | null | undefined,
): boolean {
  return canDo(plan, "whiteLabelEnabled");
}

// getOrganizationOwnerPlan/getOrgBrand (Prisma-backed) were fully superseded by
// server/orgDynamo.ts's getOrganizationOwnerPlanDynamo/getOrgBrandDynamo — every real
// caller already used the Dynamo versions; these were dead code, removed with the rest of
// the Postgres/Prisma stack.
