import { PAID_PLAN_IDS, PLAN, RETIRED_PLAN, STORED_PLAN_VALUES } from "@/lib/plan/plans";
import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-core: Organization, Member, ApiKey, UploadedImage, PlatformSettings,
// Notification, NotificationPreferences — field shapes ported 1:1 from
// prisma/schema.prisma. Organization/Member/ApiKey/UploadedImage/NotificationPreferences
// deliberately share one partition (pk: ORG#<id>) so "load an org and everything
// scoped to it" is one query, mirroring how Prisma's `include` worked across these same
// relations. Notification is keyed by recipient instead — a user's notification feed is
// the actual access pattern, not "all notifications for an org."

const table = TABLES.core;

// Only the fields actually needed by what Phase 2 ports (ledger operations, adminGuard)
// are modeled here — name/image/subscriptionPlan/billing/credit/seller/admin fields.
// The rest of the real User model (aupAcceptedAt, strataProjectId, suspendedAt, etc.)
// gets added when the phase that actually reads/writes it is implemented, same
// incremental-GSI discipline as everywhere else in this migration.
//
// `id` is shared directly with Auth.js's own adapter-managed User record (both live in
// this same plexo-core table, same pk/sk/GSI1 convention — see server/authDynamo.ts) —
// no separate external-identity foreign key needed, since auth isn't an external system
// anymore after the WorkOS -> Auth.js switch. This entity is Plexo's own business-profile
// data (credits, seller balance, admin role) keyed by the same id Auth.js assigns.
export const User = new Entity(
  {
    model: { entity: "user", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      name: { type: "string", default: "Plexo User" },
      image: { type: "string" },
      email: { type: "string", required: true },
      // FREE | STARTER | PRO | ENTERPRISE. ULTRA is the retired top plan — still a valid stored
      // value until scripts/billing/migrate-plans.ts rewrites it. Read it with planVersion
      // (lib/plan/plans.ts normalizeStoredPlan): before the 2026 rename PRO meant today's STARTER.
      subscriptionPlan: { type: STORED_PLAN_VALUES, default: PLAN.FREE },
      // Which meaning subscriptionPlan/pendingPlan/planBeforeDowngrade were written with.
      // Missing = before the rename; 2 = today's plans. Always written via planFields().
      planVersion: { type: "number", default: 2 },
      // Billing / credits
      stripeCustomerId: { type: "string" },
      stripeSubscriptionId: { type: "string" },
      // Provider-agnostic plan subscription — Stripe (USD) or Paystack (NGN/GHS/KES/ZAR).
      // subscriptionId is the Stripe subscription id or the Paystack subscription code. For
      // Stripe it always equals stripeSubscriptionId (kept for the code that predates this).
      subscriptionProvider: { type: ["STRIPE", "PAYSTACK"] as const },
      subscriptionId: { type: "string" },
      subscriptionInterval: { type: ["monthly", "yearly"] as const },
      // Paystack: the customer, and the email token Paystack needs to cancel a subscription.
      paystackCustomerCode: { type: "string" },
      paystackEmailToken: { type: "string" },
      // Where this account pays from (lib/billing/pricing.ts). Fixed at the first checkout so
      // prices can't flip with a VPN or a trip; billingCurrency "USD" also records "pay in USD instead".
      billingCountry: { type: "string" },
      // The country the owner says they're based in (ISO-3166 alpha-2) — decides the price list
      // they see (lib/billing/region.ts) ahead of billingCountry and the visitor's IP.
      country: { type: "string" },
      countrySetAt: { type: "string" },
      // When we last asked an existing account for its country and they chose "Later".
      countryAskedAt: { type: "string" },
      billingCurrency: { type: ["USD", "NGN", "GHS", "KES", "ZAR"] as const },
      billingRegion: { type: "string" },
      billingRegionLockedAt: { type: "string" },
      // A plan change already booked for the next renewal (the 2026 plan move: old Pro → Starter
      // price). Shown on the billing page; cleared once the renewal goes through.
      scheduledPlan: { type: PAID_PLAN_IDS },
      scheduledPlanAt: { type: "string" },
      // Price changes for people who already subscribe (lib/billing/priceChanges.ts, priceMove.ts).
      // What each renewal charges now, in minor units (kept up to date by the provider webhooks and
      // the move job); the last change already applied (effective date#version); when we moved them;
      // and, for Paystack, the old subscription still to be switched off after a move.
      subscriptionAmountMinor: { type: "number" },
      priceChangeKey: { type: "string" },
      priceMovedAt: { type: "string" },
      // After a move, before the renewal that charges it: the new amount (minor units) and that renewal's date.
      nextAmountMinor: { type: "number" },
      nextAmountAt: { type: "string" },
      paystackRetireCode: { type: "string" },
      paystackRetireToken: { type: "string" },
      // The change whose heads-up email this person already got (one email per change).
      priceNoticeKey: { type: "string" },
      allowanceBalance: { type: "number", default: 0 },
      topupBalance: { type: "number", default: 0 },
      allowanceResetAt: { type: "string", default: () => new Date().toISOString() },
      // Credits held for AI turns that are running right now — { [turnId]: { credits, expiresAt } },
      // with heldCredits the cached sum of the live ones. See holdCredits in
      // lib/db/ledgerOperations.ts: it's what stops two chats at once spending the same credits.
      creditHolds: { type: "any" },
      heldCredits: { type: "number" },
      // Marketplace seller earnings (cents) — reserved at withdrawal request, not at
      // processing time, same semantics as today (see docs comment on the Prisma field).
      sellerBalanceCents: { type: "number", default: 0 },
      // Platform admin — null = ordinary customer, set = Charisol staff (plexo-admin).
      adminRole: { type: ["SUPERADMIN", "SUPPORT", "MODERATOR", "FINANCE"] as const },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // Dashboard shell UI preference — server/orgDynamo.ts's cutover of app/dashboard/layout.tsx.
      layoutMode: { type: ["CLASSIC", "MODERN"] as const, default: "CLASSIC" },
      // Default landing surface after login — the normal dashboard, or the full-screen
      // SOL (AI agent chat) view. See lib/db/solEntities.ts for SOL's own data.
      preferredSurface: { type: ["DASHBOARD", "SOL"] as const, default: "DASHBOARD" },
      // Plan-gated preferences (resolveHideBranding/resolveManageLandingPagePublishing in
      // lib/subscription.ts do the actual entitlement collapse — these store the raw
      // stated preference, same as Prisma did).
      hideBranding: { type: "boolean", default: false },
      manageLandingPagePublishing: { type: "boolean", default: false },
      // Plan picked at signup before email verification completes — see server/auth.ts's
      // databaseHooks and app/auth/complete-subscription. Null once resolved.
      pendingPlan: { type: [PLAN.STARTER, PLAN.PRO, RETIRED_PLAN.ULTRA, PLAN.ENTERPRISE] as const },
      // Per-user override of the plan-default published-domain cap — null defers to
      // getDomainLimit()'s plan-based default (app/api/v1/domains/route.ts).
      customDomainLimit: { type: "number" },
      // Acceptable Use Policy acceptance gate for publishing unsanitized raw HTML
      // (app/api/templates/route.ts, app/api/v1/templates/upload-raw/route.ts).
      aupAcceptedAt: { type: "string" },
      // The Strata design-system project this account is connected to, for the MCP
      // get_strata_tokens tool (server/strata.ts) — null until the user connects one.
      strataProjectId: { type: "string" },
      // Auth.js cutover (server/authDynamo.ts's Credentials provider) — schemaless
      // additive, matching plexo-admin's own identical addition to this same physical
      // User record shape. Empty-string default matches the Prisma column's own
      // `@default("")` (Google-only accounts never set this).
      passwordHash: { type: "string", default: "" },
      // Mirrors better-auth's `emailVerified` (aliased to this field name in server/auth.ts's
      // config) — tracked independently of Auth.js's own adapter-managed `emailVerified`
      // column so the Credentials provider's "is this account allowed to sign in yet" check
      // doesn't depend on OAuth-account-linking internals it has nothing to do with.
      isConfirmed: { type: "boolean", default: false },
      suspendedAt: { type: "string" },
      suspendedReason: { type: "string" },
      // Charisol Auth (server/charisolAccount.ts). `charisolSub` is the shared Charisol
      // account this user signed in as (Google or password). `charisolPasswordAt` is set the
      // first time they sign in with a Charisol PASSWORD — from then on Charisol holds their
      // password and the local `passwordHash` is never accepted again (see authDynamo.ts).
      charisolSub: { type: "string" },
      charisolPasswordAt: { type: "string" },
      // Set when Charisol sign-in creates this account (server/charisolAccount.ts). Read once by
      // /api/auth/signup-event for the sign_up analytics event, then cleared.
      signupEventPendingAt: { type: "string" },
      // The account's first successful app publish (set once by /api/analytics/publish-success).
      firstPublishedAt: { type: "string" },
      // Self-selected once on first visit to /dashboard/funnels (Funnel/LMS module) —
      // reshapes both the funnel-creation flow and the ongoing page-builder's guidance
      // density (see the Funnel/LMS plan's "Experience-level onboarding" section). Null
      // until chosen; changeable anytime after via Funnel settings, never a one-way door.
      funnelBuilderLevel: { type: ["BEGINNER", "INTERMEDIATE", "PROFESSIONAL"] as const },
      // "Is this person actually using Plexo" for the admin console (plexo-admin's Users
      // list/detail) — one unified signal rather than separate login/API-usage tracking,
      // since sessions here are JWT-only (no Session row to hang a "last login" off) and a
      // per-request write on every dashboard load or API call would be real, avoidable
      // DynamoDB cost for a signal nobody needs to the minute. Written by
      // lib/auth/resolveUser.ts — the one chokepoint already shared by both the dashboard
      // (session-authenticated) and the public v1 API (key-authenticated) — throttled to
      // at most once per hour per user (see resolveUser.ts's ACTIVITY_THROTTLE_MS), so even
      // a heavy user costs ~24 tiny writes/day, not one per request. lastActiveContext is a
      // short human label (lib/activity.ts's describeActivity) for what that last call
      // actually was, so admin doesn't just see a timestamp with no idea what it means.
      lastActiveAt: { type: "string" },
      lastActiveContext: { type: "string" },
      // ── Plan lifecycle (lib/plan) ────────────────────────────────────────────────
      // Mirrors the Stripe subscription behind subscriptionPlan (webhooks/stripe). PAST_DUE
      // keeps the plan while Stripe retries the card; CANCELED means the payment has ended.
      subscriptionStatus: { type: ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED"] as const },
      // Paid access that isn't a subscription: the 14-day trial, or an admin grant with an
      // end date. The plan drops to Free once this passes (unless planKeptByAdmin).
      planAccessUntil: { type: "string" },
      planAccessSource: { type: ["TRIAL", "ADMIN"] as const },
      // One trial per account, ever. trialOfferSeenAt: the post-signup offer was shown.
      trialStartedAt: { type: "string" },
      trialOfferSeenAt: { type: "string" },
      // The "your access ends in a few days" email for the current planAccessUntil was sent.
      planAccessReminderSentAt: { type: "string" },
      // The latest "your plan ends" reminder sent, as "<end date>#WEEK|DAY|TODAY" (lib/plan/reminders.ts):
      // one email per stage per end date, so a week/day/today reminder never repeats.
      planExpiryReminderKey: { type: "string" },
      // The admin console's "Keep on plan" switch: this account keeps subscriptionPlan
      // indefinitely, with no payment, and is never downgraded automatically.
      planKeptByAdmin: { type: "boolean", default: false },
      // Set while the account is on Free after having had a paid plan — what the dashboard
      // explains, and what tells the lifecycle there's an archive to restore on upgrade.
      planDowngradedAt: { type: "string" },
      planDowngradeReason: { type: ["PAYMENT_ENDED", "TRIAL_ENDED", "GRANT_ENDED", "NO_PAYMENT", "ADMIN"] as const },
      planBeforeDowngrade: { type: [PLAN.STARTER, PLAN.PRO, RETIRED_PLAN.ULTRA, PLAN.ENTERPRISE] as const },
      // When Free's limits (one live site, homepage only, no custom domain) were last
      // applied to this account's sites. Cleared on upgrade, so a later downgrade re-applies.
      freeLimitsAppliedAt: { type: "string" },
      // Last time a subscription with no recorded status was checked against Stripe.
      subscriptionCheckedAt: { type: "string" },
      // Short lease so two requests never run the same downgrade/restore at once.
      planSyncLockUntil: { type: "string" },
      // ── Billing snapshot (lib/billing/payments.ts, webhooks/stripe) ─────────────────
      // The card most recently charged successfully — brand + last 4 + expiry only, never
      // anything more — and the current plan subscription's period, so the dashboard and
      // the admin console can show them without calling Stripe.
      billingCardBrand: { type: "string" },
      billingCardLast4: { type: "string" },
      billingCardExpMonth: { type: "number" },
      billingCardExpYear: { type: "number" },
      subscriptionStartedAt: { type: "string" },
      subscriptionPeriodEnd: { type: "string" },
      subscriptionCancelAtPeriodEnd: { type: "boolean" },
      // ── Dashboard versions (docs/DASHBOARD_VERSIONS.md; lib/dashboardVersions) ──────
      // Which dashboard they chose / were moved to (a registry id, e.g. "classic", "v3"). The
      // LAST entry of the history is the truth; this mirrors it for fast reads.
      dashboardVersion: { type: "string" },
      // Admin-locked: they can't switch away (mandatory rollout needs no flag).
      dashboardVersionLocked: { type: "boolean" },
      // [{ at, from, to, by: "user"|"admin"|"rollout", adminId?, note? }], capped at 50.
      dashboardVersionHistory: { type: "any" },
      // The audience: { [versionId]: "optional" | "locked" } — added by an admin (SELECTED/OFFERED).
      dashboardVersionAccess: { type: "any" },
      // Offer answers: { [versionId]: { snoozeUntil?, never?, askedAt? } }.
      dashboardOffers: { type: "any" },
      // ── v3 dashboard (docs/redesign/SPEC.md; lib/dashboardV3) ───────────────────────
      // Per-user override of the DASHBOARD_V3 env flag (staff/testing). Unset = follow the env.
      dashboardV3: { type: "boolean" },
      // "beginner" = guided view with fewer menu items; "pro" = everything, denser. Switchable
      // in Settings and from Home. Unset reads as beginner (lib/dashboardV3/profile.ts).
      experience: { type: ["beginner", "intermediate", "pro"] as const },
      // What they're building, from onboarding — read by SOL (lib/ai/solBuildContext.ts
      // loadBuildProfile) and by Home's guided tasks. Shape: SolBuildProfile, validated by
      // lib/dashboardV3/profile.ts sanitizeBuildProfile before it's stored.
      buildProfile: { type: "any" },
      // 3 = finished the redesign's onboarding (/welcome/setup). Below 3 they see it once.
      onboardingVersion: { type: "number" },
      // "Continue later" on onboarding: Home then shows a "Set up your first site" card instead.
      onboardingDeferredAt: { type: "string" },
      // Light / Dark / System (default System when unset). Mirrored in the plexo-theme cookie.
      themePreference: { type: ["light", "dark", "system"] as const },
      // The product walkthrough (app/dashboard/_v3/tour): whether they've been asked, which tour
      // and where they are in it, so it resumes across pages and devices. lib/dashboardV3/tour.ts.
      tourState: { type: "any" },
      // Promo banners (lib/promos) this person closed: { [promoId]: versionTheyClosed }. A promo
      // the admin edits gets a new version, so an updated message is shown again.
      dismissedPromos: { type: "any" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["id"], template: "USER#${id}" },
        sk: { field: "sk", composite: [], template: "USER#METADATA" },
      },
      // Email is unique (prisma: @unique) — the login-by-email access pattern.
      byEmail: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["email"], template: "EMAIL#${email}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "USER#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Closes a real race: User.id is a fresh UUID, not the email, so `byEmail` (a GSI query,
// not a DB constraint) can't stop two concurrent requests for the same address — a
// double-submitted signup, or a race between password registration and Google/Charisol
// sign-in — from both passing a "does this email exist" check and both calling
// User.create(). Two User rows then independently join/own orgs, which is what surfaces
// in plexo-admin as "the same person shows up twice" under one organization. This item's
// key IS the uniqueness constraint: created in the same transaction as the User row
// (server/authDynamo.ts, app/api/auth/register/route.ts), conditioned on not already
// existing, so only one of two racing signups for one email can ever win.
export const UserEmailLock = new Entity(
  {
    model: { entity: "userEmailLock", version: "1", service: "plexoCore" },
    attributes: {
      email: { type: "string", required: true },
      userId: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["email"], template: "EMAILLOCK#${email}" },
        sk: { field: "sk", composite: [], template: "EMAILLOCK#METADATA" },
      },
    },
  },
  { table, client: docClient },
);

// A pending email-confirmation link. The emailed link carries only the random token; this row
// maps that token to the account, so the email address never has to appear in the URL.
// Single use: the verify route deletes it when it's used. Expired rows are ignored by checking expiresAt.
export const EmailVerifyLink = new Entity(
  {
    model: { entity: "emailVerifyLink", version: "1", service: "plexoCore" },
    attributes: {
      token: { type: "string", required: true },
      userId: { type: "string", required: true },
      expiresAt: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["token"], template: "EMAILVERIFY#${token}" },
        sk: { field: "sk", composite: [], template: "EMAILVERIFY#METADATA" },
      },
    },
  },
  { table, client: docClient },
);

// A person's Strata (Charisol design system) session — what lets the editor's Branding panel
// read and update their Strata projects on their behalf (lib/strata). One row per Plexo
// user. The token is a Strata session JWT (~24h), stored ENCRYPTED (lib/crypto.ts
// encryptStrataToken) and never sent back to the browser; connectedAt is when Strata issued
// it, which is how "expired" is told apart from "never connected". Only a primary-key lookup
// is ever needed, so no GSI.
export const StrataSession = new Entity(
  {
    model: { entity: "strataSession", version: "1", service: "plexoCore" },
    attributes: {
      userId: { type: "string", required: true },
      ciphertext: { type: "string", required: true },
      // Who the Strata account is — shown as "Connected as …", never used for access decisions.
      strataEmail: { type: "string" },
      strataName: { type: "string" },
      connectedAt: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: [], template: "STRATASESSION" },
      },
    },
  },
  { table, client: docClient },
);

// The person's Charisol sign-in, kept on the server (encrypted) so another Charisol product — Strata today — can be opened as
// them without asking them to sign in again: Charisol's own browser session only lasts about an hour, but this renews a fresh
// ID token whenever it's needed (lib/charisolLink.ts). Never returned to the browser; removed when they sign out of Plexo.
export const CharisolLink = new Entity(
  {
    model: { entity: "charisolLink", version: "1", service: "plexoCore" },
    attributes: {
      userId: { type: "string", required: true },
      ciphertext: { type: "string", required: true },
      storedAt: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: [], template: "CHARISOLLINK" },
      },
    },
  },
  { table, client: docClient },
);

// "Keep my website up to date with Strata" (lib/strata/autoUpdate.ts): one row per app that has
// automatic updates on. It holds a read-only Strata integration key (scope design-system:read,
// limited to the one linked project), stored ENCRYPTED and never sent to the browser, so a
// scheduled job can check Strata without the owner being signed in. runningAt is the per-app
// lock (a run older than a few minutes is treated as dead). The scheduled sweep scans this
// small table for status "active".
export const StrataAutoUpdate = new Entity(
  {
    model: { entity: "strataAutoUpdate", version: "1", service: "plexoCore" },
    attributes: {
      appId: { type: "string", required: true },
      userId: { type: "string", required: true },
      strataProjectId: { type: "string", required: true },
      keyId: { type: "string", required: true },
      ciphertext: { type: "string", required: true },
      status: { type: ["active", "needs-reconnect"] as const, required: true },
      createdAt: { type: "string", required: true },
      lastCheckedAt: { type: "string" },
      lastRevision: { type: "string" },
      // What the last check found, for the Design tab: "updated" | "up-to-date" | "needs-review" | "error" | "reconnect".
      lastResultKind: { type: "string" },
      lastResult: { type: "string" },
      runningAt: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["appId"], template: "APP#${appId}" },
        sk: { field: "sk", composite: [], template: "STRATAAUTOUPDATE" },
      },
    },
  },
  { table, client: docClient },
);

// A site's brand, linked from Strata (lib/brand/siteBrand.ts): ONE Strata project per site
// (siteId = the site's root Template id — builder, raw upload, WordPress-migrated, React app,
// deployed static or server app alike). The brand itself is written as a hosted stylesheet
// (/__plexo/brand/<siteId>.css) every page of the site links to, so a change in Strata reaches
// every page without recompiling. Holds a read-only Strata integration key (scope
// design-system:read, the one project only), stored ENCRYPTED and never sent to a browser, so the
// webhook receiver and the scheduled sweep can pull the published design system with nobody
// signed in. `revision` is the sheet's own version (what ?v= carries); `strataRevision` is the
// Strata revision it was made from. runningAt is the per-site lock.
//
// byStrataProject (GSI1, no new index needed): "every site linked to this Strata project" — how a
// webhook for one project finds the sites to update.
export const SiteBrand = new Entity(
  {
    model: { entity: "siteBrand", version: "1", service: "plexoCore" },
    attributes: {
      siteId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      // Who linked it: their name goes on rebuilds the sync starts, and their Strata session is
      // used (when still signed in) to tidy up in Strata on unlink.
      userId: { type: "string", required: true },
      strataProjectId: { type: "string", required: true },
      projectName: { type: "string" },
      // The project's logo address (https), read from Strata when linking, so every surface can show the brand's logo.
      projectLogo: { type: "string" },
      // The Strata asset id of that logo, so a logo replaced in Strata is noticed (asset id + address) on every sync.
      projectLogoId: { type: "string" },
      // Plexo made the Strata project from this site's brand (so it may retry publishing it), and nothing has been published in Strata yet.
      plexoCreated: { type: "boolean" },
      // A deployed server app: Plexo adds the brand link to the HTML pages it serves. Absent = off, so every site that was linked
      // before this existed serves exactly what it did; only the owner's switch (or linking from now on) turns it on.
      injectServerApp: { type: "boolean" },
      awaitingPublish: { type: "boolean" },
      // The owner's latest colours/logo are saved on Plexo but not in Strata yet (it was unreachable). Retried on the next save, by the
      // 15-minute sweep, and by the owner's "Send to Strata" button. Absent = nothing waiting.
      pendingPush: { type: "boolean" },
      // What is waiting besides colours/logo (same retry: next save, the sweep, "Send to Strata"): components made in Plexo (a JSON list of
      // component rows) and token changes (a JSON request: colours, fonts, radius, spacing). Absent = nothing waiting. pendingBrand says the
      // colours/logo themselves are waiting (rows from before this existed that are pendingPush with none of these count as brand).
      pendingComponents: { type: "string" },
      pendingTokens: { type: "string" },
      pendingBrand: { type: "boolean" },
      pushError: { type: "string" },
      pushTriedAt: { type: "string" },
      keyId: { type: "string", required: true },
      ciphertext: { type: "string", required: true },
      // "Keep in sync with Strata": publishes in Strata go live on their own.
      autoSync: { type: "boolean", default: true },
      status: { type: ["active", "needs-reconnect"] as const, required: true, default: "active" },
      revision: { type: "string" },
      strataRevision: { type: "string" },
      sheetUpdatedAt: { type: "string" },
      lastCheckedAt: { type: "string" },
      // "updated" | "up-to-date" | "needs-review" | "error" | "reconnect" — and the plain-language note.
      lastResultKind: { type: "string" },
      lastResult: { type: "string" },
      lastSource: { type: ["webhook", "schedule", "owner"] as const },
      runningAt: { type: "string" },
      createdAt: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["siteId"], template: "SITE#${siteId}" },
        sk: { field: "sk", composite: [], template: "SITEBRAND" },
      },
      byStrataProject: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["strataProjectId"], template: "STRATAPROJECT#${strataProjectId}", casing: "none" },
        sk: { field: "GSI1SK", composite: ["siteId"], template: "SITEBRAND#${siteId}", casing: "none" },
      },
    },
  },
  { table, client: docClient },
);

// Plexo's webhook subscription in Strata for one project (shared by every site linked to it):
// Strata signs each delivery with `secret` (HMAC-SHA256), stored ENCRYPTED. `createdWith` says
// which credential made it — a person's session ("session") or a site's integration key (its
// keyId): a key-made subscription stops when that key is revoked, so unlinking that site moves it.
export const StrataProjectWebhook = new Entity(
  {
    model: { entity: "strataProjectWebhook", version: "1", service: "plexoCore" },
    attributes: {
      strataProjectId: { type: "string", required: true },
      webhookId: { type: "string", required: true },
      secretCiphertext: { type: "string", required: true },
      createdWith: { type: "string", required: true },
      createdAt: { type: "string", required: true },
      lastDeliveryId: { type: "string" },
      lastDeliveryAt: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["strataProjectId"], template: "STRATAPROJECT#${strataProjectId}", casing: "none" },
        sk: { field: "sk", composite: [], template: "WEBHOOK" },
      },
    },
  },
  { table, client: docClient },
);

// How a raw-HTML or WordPress-migrated site's own colours and fonts map onto brand variables
// (lib/brand/mapping.ts). Worked out on import and on "Apply my brand"; applied at serve time
// (the stored pages and files are never changed), so turning "Use my brand on this site" off puts
// the original look straight back. `colors`: normalised literal -> token key; `fonts`: lower-case
// family -> token key.
export const SiteBrandMapping = new Entity(
  {
    model: { entity: "siteBrandMapping", version: "1", service: "plexoCore" },
    attributes: {
      siteId: { type: "string", required: true },
      colors: { type: "any", required: true },
      fonts: { type: "any", required: true },
      enabled: { type: "boolean", default: true },
      computedAt: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["siteId"], template: "SITE#${siteId}" },
        sk: { field: "sk", composite: [], template: "BRANDMAPPING" },
      },
    },
  },
  { table, client: docClient },
);

export const Organization = new Entity(
  {
    model: { entity: "organization", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      logo: { type: "string" },
      brandColor: { type: "string" },
      // What the brand mark actually shows wherever it's rendered (dashboard chrome,
      // invite emails) — an org with both a logo and a name set can still choose to show
      // just one instead of always both. Defaults to BOTH, matching every existing org's
      // actual current behavior before this field existed.
      brandDisplayMode: { type: ["LOGO_ONLY", "NAME_ONLY", "BOTH"] as const, default: "BOTH" },
      whiteLabelEnabled: { type: "boolean", default: false },
      commerceWalletPooled: { type: "boolean", default: false },
      metadata: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["id"], template: "ORG#${id}" },
        sk: { field: "sk", composite: [], template: "ORG#METADATA" },
      },
      // Slug is unique per Organization (prisma: @unique) — this is the lookup used
      // wherever a request arrives keyed by slug (e.g. a tenant subdomain) rather than id.
      bySlug: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["slug"], template: "ORGSLUG#${slug}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "ORG#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const Member = new Entity(
  {
    model: { entity: "member", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      userId: { type: "string", required: true },
      // Values match accessControl.ts's OrgRole — this is entirely our own data now
      // (no external identity provider to defer to), same as it was under Prisma.
      role: { type: ["owner", "admin", "editor", "blogger", "commenter", "viewer"] as const, required: true },
      // Granular-permissions v1 (enterprise-eval gap: today every role is org-wide — an
      // `editor` can touch every template in the org, no way to say "this page only").
      // Absent or empty = unchanged today's behavior (org-wide access for whatever the
      // role's accessControl.ts statement already allows) — fully backward compatible,
      // no migration needed. Only ever meaningful for role "editor" (see
      // server/requireTemplateScope.ts and server/orgDynamo.ts's updateMemberRole, which
      // clears this outright for every other role) — owner/admin are never scopable in
      // this v1. Checked by server/requireTemplateScope.ts in every template-mutation
      // route, same "second, narrower check after the role check" pattern as
      // requirePermissionDynamo.ts itself.
      scopedTemplateIds: { type: "list", items: { type: "string" } },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "sk", composite: ["userId"], template: "MEMBER#${userId}" },
      },
      // "every org this user belongs to" — the Prisma @@index([userId]) equivalent.
      byUser: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "GSI1SK", composite: ["organizationId"], template: "MEMBERSHIP#${organizationId}" },
      },
    },
  },
  { table, client: docClient },
);

export const ApiKey = new Entity(
  {
    model: { entity: "apiKey", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      name: { type: "string", required: true },
      hashedKey: { type: "string", required: true },
      maskedKey: { type: "string", required: true },
      useAi: { type: "boolean", default: false },
      aiProvider: { type: "string", default: "openai" },
      aiTier: { type: ["AUTO", "BASIC", "MEDIUM", "HIGH"] as const, default: "AUTO" },
      aiApiKey: { type: "string" },
      isActive: { type: "boolean", default: true },
      aiAccessMode: { type: ["SYSTEM", "BYOK", "HOST_MANAGED"] as const, default: "SYSTEM" },
      hostAuthWebhookUrl: { type: "string" },
      hostWebhookSecret: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      lastUsedAt: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "sk", composite: ["id"], template: "APIKEY#${id}" },
      },
      byUser: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "APIKEY#${id}" },
      },
      // The API-key-authentication lookup (every x-api-key/Bearer-authenticated request
      // across the public API surface, see lib/auth/resolveUser.ts) — prisma's own
      // findFirst({OR: [{hashedKey}, {maskedKey}]}) had no index either (grepped
      // prisma/schema.prisma to confirm, not assumed), but a full scan on DynamoDB is the
      // thing worth avoiding on a security-critical, called-on-every-request path, so
      // this gets an explicit GSI here where an unindexed lookup would otherwise silently
      // become a Scan. maskedKey is checked in application code as a fallback (see
      // resolveUser) rather than a second index — it's the "the raw key equals what a
      // human already sees as the masked value" edge case, not a hot path.
      byHashedKey: {
        index: "GSI2",
        pk: { field: "GSI2PK", composite: ["hashedKey"], template: "APIKEYHASH#${hashedKey}" },
        sk: { field: "GSI2SK", composite: ["id"], template: "APIKEY#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// A registered OAuth client (the MCP directory submission's Dynamic Client Registration
// requirement — RFC 7591). Previously /api/v1/auth/oauth/register handed every caller
// back the SAME hardcoded client_id/client_secret regardless of what it registered, so
// there was nothing here to actually look up — /authorize trusted whatever redirect_uri
// a caller supplied with zero validation, a real open-redirect: a crafted authorize link
// could redirect a logged-in user's real Plexo API key to an attacker's domain. This
// persists what each client actually registered so /authorize can reject any redirect_uri
// that doesn't exactly match what that client_id registered.
export const OAuthClient = new Entity(
  {
    model: { entity: "oauthClient", version: "1", service: "plexoCore" },
    attributes: {
      clientId: { type: "string", required: true },
      // Unset for a public client (token_endpoint_auth_method: "none", PKCE-only — what
      // every MCP client we've seen actually uses). Hashed the same way ApiKey.hashedKey
      // is — never store the raw secret.
      clientSecretHash: { type: "string" },
      clientName: { type: "string", required: true },
      redirectUris: { type: "list", items: { type: "string" }, required: true },
      tokenEndpointAuthMethod: { type: ["none", "client_secret_post", "client_secret_basic"] as const, default: "none" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["clientId"], template: "OAUTHCLIENT#${clientId}" },
        sk: { field: "sk", composite: [], template: "OAUTHCLIENT" },
      },
    },
  },
  { table, client: docClient },
);

export const UploadedImage = new Entity(
  {
    model: { entity: "uploadedImage", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      name: { type: "string", required: true },
      url: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "sk", composite: ["id"], template: "IMAGE#${id}" },
      },
      byUser: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "IMAGE#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Singleton — id is always the literal "global", same as Prisma's default("global").
export const PlatformSettings = new Entity(
  {
    model: { entity: "platformSettings", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", default: "global", readOnly: true },
      autoPublishMarketplaceListings: { type: "boolean", default: false },
      marketplaceFeeBps: { type: "number", default: 2000 },
      commercePlatformFeeBps: { type: "number", default: 0 },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "PLATFORM#global" },
        sk: { field: "sk", composite: [], template: "PLATFORM#global" },
      },
    },
  },
  { table, client: docClient },
);

// The price book (lib/billing/pricing.ts): country groups with currency, provider and prices,
// edited in plexo-admin's Pricing page. One row — "current" — so a save is atomic and the app
// reads it in one get (cached ~60s by lib/billing/priceBook.ts). `version` is bumped by every
// save and checked on write, so two admins saving at once can't silently overwrite each other.
// Missing row = the built-in defaults (DEFAULT_PRICE_BOOK).
export const PriceBookRecord = new Entity(
  {
    model: { entity: "priceBook", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", default: "current", readOnly: true },
      version: { type: "number", required: true },
      defaultGroupId: { type: "string", required: true },
      groups: { type: "any", required: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
      updatedBy: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["id"], template: "PRICEBOOK#${id}" },
        sk: { field: "sk", composite: [], template: "PRICEBOOK#METADATA" },
      },
    },
  },
  { table, client: docClient },
);

// Who changed the price book, when, and what (a short summary plus both versions in full).
// Written by plexo-admin in the same transaction as the PriceBookRecord save. Newest first.
export const PriceBookAudit = new Entity(
  {
    model: { entity: "priceBookAudit", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      changedAt: { type: "string", required: true },
      changedById: { type: "string", required: true },
      changedByEmail: { type: "string" },
      version: { type: "number", required: true },
      summary: { type: "list", items: { type: "string" } },
      before: { type: "any" },
      after: { type: "any" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "PRICEBOOKAUDIT" },
        sk: { field: "sk", composite: ["changedAt", "id"], template: "AUDIT#${changedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Promo banners: the slim "new thing" strip at the top of the dashboard (lib/promos, app/dashboard/_v3/promo).
// plexo-admin writes these (editing never touches `clicks`, which the dashboard bumps), the dashboard
// reads them through a ~60s cache. All rows live under one partition so a read is a single small query.
// Missing rows = no banner. `version` bumps whenever the wording/link/image changes, so people who
// closed the old message see the updated one.
export const Promo = new Entity(
  {
    model: { entity: "promo", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      version: { type: "number", required: true },
      enabled: { type: "boolean", required: true },
      priority: { type: "number", required: true },
      feature: { type: "string", required: true },
      // "all" (default) or "developers" (shown only to developers, closed for good). lib/promos.
      audience: { type: ["all", "developers"] as const, default: "all" },
      headline: { type: "string", required: true },
      body: { type: "string" },
      buttonLabel: { type: "string", required: true },
      href: { type: "string", required: true },
      imageUrl: { type: "string" },
      tone: { type: ["light", "dark", "brand"] as const, required: true },
      startsAt: { type: "string" },
      endsAt: { type: "string" },
      clicks: { type: "number", default: 0 },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
      updatedBy: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "PROMOS" },
        sk: { field: "sk", composite: ["id"], template: "PROMO#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Who changed a promo, when, and what. Written by plexo-admin with every promo save. Newest first.
export const PromoAudit = new Entity(
  {
    model: { entity: "promoAudit", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      promoId: { type: "string", required: true },
      changedAt: { type: "string", required: true },
      changedById: { type: "string", required: true },
      changedByEmail: { type: "string" },
      summary: { type: "string" },
      before: { type: "any" },
      after: { type: "any" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "PROMOAUDIT" },
        sk: { field: "sk", composite: ["changedAt", "id"], template: "AUDIT#${changedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// One row per price-book save that changed an amount: the old and new price per plan, interval
// and price list, and when people who already subscribe move to it (see lib/billing/priceChanges.ts).
// Written by plexo-admin in the same transaction as the PriceBookRecord save; plexo-web's move job
// sets startedAt on the first move. Admin may change effectiveFrom or cancel only while startedAt is unset.
export const PriceChange = new Entity(
  {
    model: { entity: "priceChange", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      version: { type: "number", required: true },
      createdAt: { type: "string", required: true },
      createdByEmail: { type: "string" },
      existingSubscribers: { type: "any", required: true },
      effectiveFrom: { type: "string", required: true },
      status: { type: ["scheduled", "cancelled"] as const, default: "scheduled" },
      startedAt: { type: "string" },
      cancelledAt: { type: "string" },
      entries: { type: "any", required: true },
      moveRemovedYearlyToMonthly: { type: "boolean" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "PRICECHANGE" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "CHANGE#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const Notification = new Entity(
  {
    model: { entity: "notification", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      userId: { type: "string", required: true },
      type: { type: ["MENTION", "COMMENT_REPLY", "COMMENT_RESOLVED", "INVITE_ACCEPTED"] as const, required: true },
      actorId: { type: "string" },
      commentId: { type: "string" },
      templateId: { type: "string" },
      readAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // A user's notification feed, newest first — the primary real access pattern
      // (prisma: @@index([userId, readAt])).
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "NOTIF#${createdAt}#${id}" },
      },
      // Org-wide notification listing (prisma: @@index([organizationId])) — admin/support use.
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "NOTIF#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const NotificationPreferences = new Entity(
  {
    model: { entity: "notificationPreferences", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      formSubmissions: { type: "boolean", default: false },
      blogComments: { type: "boolean", default: true },
      payments: { type: "boolean", default: true },
      commentMentions: { type: "boolean", default: true },
      notificationEmail: { type: "string" },
    },
    indexes: {
      // One per org, co-located with the Organization root item.
      primary: {
        pk: { field: "pk", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "sk", composite: [], template: "NOTIFPREFS" },
      },
    },
  },
  { table, client: docClient },
);

// better-auth's organization plugin managed this internally (its own Invitation model,
// createInvitation/getInvitation/acceptInvitation/rejectInvitation endpoints) — Auth.js
// has no organization concept at all, so this entity plus the invite/accept/reject flow
// in server/orgDynamo.ts is genuinely new code, not a mechanical port. Field shapes match
// prisma/schema.prisma's Invitation model exactly.
export const Invitation = new Entity(
  {
    model: { entity: "invitation", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      email: { type: "string", required: true },
      role: { type: ["owner", "admin", "editor", "blogger", "commenter", "viewer"] as const, required: true },
      // Same granular-permissions v1 field as Member.scopedTemplateIds above, set at
      // invite time so a scoped editor can be configured before they've even accepted —
      // carried over onto the Member row acceptInvitation creates (server/orgDynamo.ts).
      scopedTemplateIds: { type: "list", items: { type: "string" } },
      status: { type: ["pending", "accepted", "rejected", "canceled"] as const, default: "pending" },
      inviterId: { type: "string", required: true },
      expiresAt: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // Direct lookup by id — the only thing an accept-invite/[id] URL carries
      // (prisma: @id).
      primary: {
        pk: { field: "pk", composite: ["id"], template: "INVITATION#${id}" },
        sk: { field: "sk", composite: [], template: "INVITATION#METADATA" },
      },
      // An org's pending-invitations list (prisma: @@index([organizationId])) — the only
      // other real access pattern in the app (app/dashboard/settings/team). No byEmail
      // index: prisma's @@index([email]) turns out to be unused by any actual query —
      // grepped before modeling this, not assumed.
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "INVITE#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Bundles the org-scoped entities into one queryable collection: fetching everything
// under PK=ORG#<id> in a single request returns the org itself, its members, API keys,
// uploaded images, and notification preferences — the DynamoDB equivalent of the
// Prisma `include` this app used to reach for.
export const plexoCoreService = new Service(
  {
    User,
    UserEmailLock,
    StrataSession,
    CharisolLink,
    Organization,
    Member,
    ApiKey,
    UploadedImage,
    PlatformSettings,
    Notification,
    NotificationPreferences,
    Invitation,
  },
  { table, client: docClient },
);

// The dashboard version registry (docs/DASHBOARD_VERSIONS.md): one row per dashboard version,
// edited in plexo-admin ("Versions"), read by plexo-web (lib/dashboardVersions/store.ts). Rows
// share one partition so the whole registry is a single cheap query. plexo-admin keeps a copy.
export const DashboardVersion = new Entity(
  {
    model: { entity: "dashboardVersion", version: "1", service: "plexoCore" },
    attributes: {
      id: { type: "string", required: true },
      label: { type: "string", required: true },
      description: { type: "string" },
      whatsNew: { type: "any" },
      status: { type: ["beta", "stable", "retired"] as const, default: "beta" },
      isDefault: { type: "boolean", default: false },
      rolloutMode: { type: ["OFF", "SELECTED", "OFFERED", "MANDATORY"] as const, default: "OFF" },
      offerAudience: { type: ["everyone", "selected"] as const, default: "everyone" },
      remindAfterDays: { type: "number", default: 7 },
      sortOrder: { type: "number", default: 0 },
      updatedBy: { type: "string" },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "DASHBOARDVERSIONS" },
        sk: { field: "sk", composite: ["id"], template: "VERSION#${id}" },
      },
    },
  },
  { table, client: docClient },
);
