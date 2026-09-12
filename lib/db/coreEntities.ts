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
      subscriptionPlan: { type: ["FREE", "PRO", "ULTRA"] as const, default: "FREE" },
      // Billing / credits
      stripeCustomerId: { type: "string" },
      stripeSubscriptionId: { type: "string" },
      allowanceBalance: { type: "number", default: 0 },
      topupBalance: { type: "number", default: 0 },
      allowanceResetAt: { type: "string", default: () => new Date().toISOString() },
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
      pendingPlan: { type: ["PRO", "ULTRA"] as const },
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
