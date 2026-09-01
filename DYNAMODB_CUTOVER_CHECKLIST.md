# DynamoDB app-code cutover checklist

Tracks swapping the app's actual route handlers / server actions / client calls from
Prisma+better-auth to the ElectroDB entities + Auth.js built in AWS_MIGRATION_CHECKLIST.md's
Phases 1-7. That work built the DynamoDB data layer in parallel; this is the separate task
of actually wiring the app to use it instead of Postgres. Scoped by grep against the real
codebase (2026-09-01): 200 files import `@/server/prisma`, 47 import `@/server/auth`
(better-auth), 700+ individual `prisma.<model>.` call sites.

Sequenced by bounded context, foundation first — nothing else can be safely cut over
until session + org + permission resolution works on DynamoDB, since almost every route
depends on it.

## Core / Org / Auth foundation

- [x] `Invitation` DynamoDB entity (`lib/db/coreEntities.ts`) — didn't exist; better-auth's
      `organization` plugin managed this internally, Auth.js has no equivalent
- [x] `server/orgDynamo.ts` — ensureActiveOrganization, createOrganization, invite/accept/
      reject/cancel, member CRUD. Active-org tracking is a cookie (`plexo_active_org`), not
      a session field — see file header comment for why
- [x] `server/requirePermissionDynamo.ts` — `accessControl.ts`'s `ac`/`roles` needed **zero**
      changes (verified by reading better-auth's own `createAccessControl`/`role()` source:
      pure functions, no I/O); only the HTTP-wrapper (`auth.api.hasPermission`) needed a
      replacement
- [x] `/api/org/*` route handlers (invite, invite/[id], invite/[id]/accept, invite/[id]/reject,
      members/[userId], active) — REST replacements for `authClient.organization.*`
- [ ] Swap `app/dashboard/settings/team/team-client.tsx` and
      `app/accept-invite/[id]/accept-invite-client.tsx` to call `/api/org/*` instead of
      `authClient.organization.*`
- [ ] Swap the 47 files calling `auth.api.getSession` / importing `@/server/auth` to
      `auth()` from `@/server/authDynamo` instead (session shape differs slightly —
      `session.user.id`/`.email` still there, but no `session.session.activeOrganizationId`,
      use `ensureActiveOrganization` from `orgDynamo.ts` instead)
- [ ] `server/adminAuth.ts` (plexo-web's own admin allowlist check, separate from
      plexo-admin's `adminGuard.ts`) — verify it doesn't depend on better-auth internals
- [ ] Password-based signup/login/reset flows — Auth.js's `Credentials` provider isn't
      configured yet in `server/authDynamo.ts` (only `Google` is); needs its own bcrypt-hash
      verification against the `User` entity, or a decision to make Google-only at cutover

## Content (largest single context — Template 171 sites, TemplateAsset 25, BlogPost 24,
## BlogCategory 22, BlogTag 22, BlogSite 22, BlogAuthor 21, PublishedDomain 51, SiteLayout 13)

- [ ] Not started. Entities already exist (`lib/db/contentEntities.ts`, Phase 4) — this is
      purely swapping call sites in `app/dashboard/**`, `app/api/v1/**`, `app/[domain]/**`
      (published-site rendering — the highest-traffic read path in the whole app)

## Commerce (CommerceProduct 33, CommerceSettings 31, CommerceOrder 27, CommerceCartItem 10,
## CommerceDiscountCode 13, CommerceWallet 14, CommerceAvailabilityRule/Exception 14, etc.)

- [ ] Not started. Entities + webhook operations already exist (Phase 3/`commerceWebhookOperations.ts`)
      — checkout/booking/webhook routes are the highest-risk swap (real money), do these
      last and test exhaustively on staging before touching prod traffic

## Import (SiteImportJob 22, ImportJob 16, SiteImportPage 7, SiteTransferRequest 14)

- [ ] Not started. Entities exist (Phase 4/`importEntities.ts`)

## Ops (PageView 6) + platform-wide (User.adminRole-gated routes, Testimonial,
## ScriptAccessRequest, PlatformSettings, Notification/NotificationPreferences)

- [ ] Not started

## Cross-cutting, do once the above land

- [ ] Delete `server/auth.ts`, `server/org.ts`, `server/requirePermission.ts`,
      `lib/auth-client.ts`'s better-auth wiring, the `better-auth`/`@better-auth/prisma-adapter`
      deps, and `prisma/` itself — only after every call site above is confirmed swapped
      (grep for `@/server/prisma` and `@/server/auth` returning zero results is the exit
      condition for this whole checklist)
- [ ] Run `scripts/migration/backfillCore.ts` + `backfillAuthUsers.ts` for real (staging
      first, per the agreed plan), then extend the same pattern to the remaining ~58 models
- [ ] Parallel-run / shadow-read validation between Postgres and DynamoDB before any
      production traffic switch
