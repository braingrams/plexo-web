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

## ⚠️ Split-brain risk — read this before cutting over any entity's remaining call sites

Cutting over an entity's READ paths (list/get pages) before ALL of its WRITE paths are
cut over creates a real bug: anything created through a still-Prisma write path becomes
invisible to the now-DynamoDB read paths. Caught this for real once already — ImportJob's
create route was ported in one commit, its batch PROCESSOR (a separate file,
runBatch.ts) wasn't, so any job created after that commit would have silently never been
processed (fixed same session, see the "Port the WordPress import batch engine" commit).

Found it again, for **Template**: `app/api/templates/route.ts` and
`app/api/templates/[id]/route.ts` (list/get/update/delete) are cut over. Of the 10 other
files that called `prisma.template.create`/`.update` (anything created/edited through them
would have been invisible to the dashboard template list / overview pages already ported):
- `app/api/templates/[id]/duplicate/route.ts` — fixed
- `app/api/v1/templates/upload-raw/route.ts` — fixed
- `app/api/v1/marketplace/templates/[id]/use/route.ts` — fixed (2026-09-01)
- `app/api/v1/publish/route.ts` — fixed (2026-09-01)
- `app/api/v1/commerce/[templateId]/product-detail-layout/route.ts` — fixed (2026-09-01),
  via new `lib/commerce/adminAuthDynamo.ts`
- `app/api/site-layout/[templateId]/[kind]/route.ts` — fixed (2026-09-01), via new
  `lib/siteLayoutDynamo.ts`
- `lib/marketplaceListing.ts` — fixed (2026-09-01)
- `lib/siteImport/runJob.ts` — fixed (2026-09-01), see new "Import" section below
- `lib/mcp/blogTools.ts` — fixed (2026-09-02). Every category/tag/author/comment
  create-or-reuse and cascade-cleanup call now mirrors the equivalent already-ported REST
  admin route exactly (`app/api/blog/[templateId]/{categories,tags,authors,comments}/**`)
  rather than re-deriving the same logic a second time.
- `lib/mcp/mcpServer.ts` — fixed (2026-09-02). All ~15 Template/PublishedDomain/User
  read-write call sites across every MCP tool (publish_landing_page, create_email_template,
  update_template, create_raw_landing_page, create_landing_page_subpage,
  update_landing_page_page, delete_template, duplicate_landing_page_page,
  list_landing_pages, get_user_profile, etc.) ported. Found two more small dependencies
  needing a Dynamo port along the way: `server/strata.ts` (Strata design-token connect/
  fetch, → `server/strataDynamo.ts`, also required adding a `strataProjectId` attribute to
  the `User` entity in `lib/db/coreEntities.ts` — schemaless add, no redeploy needed) and
  `lib/vercelDomains.ts`'s domain-link/re-link logic, reused directly instead of
  reimplementing a third copy.

**Also found this pass (2026-09-01), not from the original grep — a second wave of the same
bug class, all fixed**: three RAW_UPLOAD content-editing routes
(`app/api/v1/templates/[id]/files/[...path]/route.ts`, `.../text-content/route.ts`,
`.../replace-upload/route.ts`) had already had their **blob storage** calls migrated to S3
earlier in this migration, but their **Template/TemplateAsset/PublishedDomain** reads/writes
were still 100% Prisma underneath — i.e. they looked done (no more `@vercel/blob` imports)
but weren't. Same for **`lib/safeBrowsing.ts`**'s `scanPublishedDomain`: it was already being
called from the already-"cut over" `app/api/v1/domains/route.ts`, but the function itself
still did `prisma.publishedDomain.findUnique({ where: { id } })` — a lookup shape that can't
even work against PublishedDomain's real DynamoDB key (`templateId`+`id`), so it was
silently no-op-ing (not erroring) on every scan since PublishedDomain's Dynamo cutover
landed. Signature changed to `scanPublishedDomain(templateId, id)`; every call site updated
(`domains/route.ts` x2, `publish/route.ts`, the 3 RAW_UPLOAD routes, `scan-domains` cron,
`mcpServer.ts`'s one remaining Prisma call site).

**Biggest single find this pass (2026-09-01): the main page-builder save endpoint,
`app/api/templates/update/[id]/route.ts` — the single most-used write path in the entire
app — was still 100% Prisma**, via its dependency on `lib/siteLayout.ts` (the header/footer
splicing subsystem used by every LANDING_PAGE save). Ported the whole thing to
`lib/siteLayoutDynamo.ts` (BlogSite/CommerceSettings reverse-lookups for layout fragments
use a bounded `.scan` — neither entity has an index for it, and it's rare enough — see the
file's comments) and repointed all 5 real callers: `app/api/templates/update/[id]/route.ts`,
`app/api/site-layout/[templateId]/route.ts`, `app/api/site-layout/[templateId]/[kind]/route.ts`,
`app/api/v1/commerce/[templateId]/product-detail-layout/route.ts`. The 5 dashboard pages
that also imported the old `lib/siteLayout.ts`
(`app/dashboard/templates/[id]/{page,detail,transfer,site-layout,form-submissions}.tsx`)
were fixed 2026-09-02 — they'd been fully Prisma-backed themselves, not just via
siteLayout.ts. Also wired the `PageView`/`FormSubmission` entities (`lib/db/opsEntities.ts`
— already existed, just not called from anywhere) for the detail page's 30-day traffic
count and the form-submissions inbox. `transfer/page.tsx`'s own submit target
(`app/api/templates/[id]/transfer/route.ts` → `server/siteTransfer.ts`) was deferred to
the Commerce pass at the time this was written — since done, see the Import section's
SiteTransferRequest entry.

None of this affects production (this whole branch is pre-deployment, per the agreed
staging-first plan), but it means the branch is internally inconsistent right now.
**Before staging verification, re-grep every entity this checklist marks cut over for
other create/update/delete call sites still on Prisma, the same way this section was
found** — don't assume the "obvious" route file is the only writer. This pass is proof the
advice holds: the second wave above was found only by re-grepping already-"migrated" files
for lingering `prisma.` imports, not by trusting the original file list.

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
- [x] Swap `app/dashboard/settings/team/team-client.tsx` and
      `app/accept-invite/[id]/accept-invite-client.tsx` to call `/api/org/*` instead of
      `authClient.organization.*`
- [x] `types/next-auth.d.ts` — session.user.id augmentation (Auth.js doesn't include it by
      default even with the database strategy; `server/authDynamo.ts` needed a
      `callbacks.session` to actually populate it)
- [x] `lib/auth/resolveUser.ts` — the shared session-or-API-key resolver used by 29 v1 API
      routes, moved out of `app/api/v1/domains/route.ts` to a proper home. Required adding
      `ApiKey`'s `byHashedKey` GSI2 (`lib/db/coreEntities.ts`) + `secondGsi: true` on the
      Core table (`cdk/lib/data-stack.ts`) — the hashedKey lookup needed a real index, not
      a Scan, on a security-critical every-request path (maildrip-server/CLAUDE.md's "Scan
      is a code smell" rule). **Data stack needs redeploying** (`STACK_KIND=data`) before
      this GSI exists for real — additive change, safe on a live table, no other GSI/table
      touched. Verified 2026-09-02 via `cdk diff` against both real deployed stacks
      (`STACK_ID=staging-plexo` and `STACK_ID=production-plexo PLEXO_ENV=production`,
      `AWS_PROFILE=plexo AWS_REGION=us-east-1`, from `cdk/`): both diffs are purely
      additive (Core table gains GSI2, a new `UserContentBucket` S3 bucket + policy, a
      cosmetic IAM principal templating change) — no table replacement, no data loss, on
      either stack. **Not deployed** — the sandbox's own safety classifier refused to run
      `cdk deploy` regardless of the reviewed risk; run these two commands manually:
      `STACK_ID=staging-plexo STACK_KIND=data AWS_PROFILE=plexo AWS_REGION=us-east-1 npx cdk deploy --require-approval never`
      and `STACK_ID=production-plexo STACK_KIND=data PLEXO_ENV=production AWS_PROFILE=plexo AWS_REGION=us-east-1 npx cdk deploy --require-approval never`.
      (First `cdk diff` attempt against production was run without `PLEXO_ENV=production`
      and falsely showed every table being replaced/renamed — a diff-invocation mistake,
      not a real bug in `cdk/lib/data-stack.ts`'s naming logic; corrected before concluding
      anything, never came close to actually running the bad command.)
- [x] 21 Core-only files swapped and type-clean: dashboard layout/profile, choose-org,
      complete-subscription, mcp/login, billing checkout/portal, organizations/[id]/branding,
      settings (api-keys, notifications, branding, ai, subscription — the last needed
      `ensureCreditPeriod` actually ported to `lib/db/ledgerOperations.ts`, previously just
      a stub comment), insights, integrations, sdk, marketplace/payouts +
      `/api/v1/marketplace/withdrawals` (3-item TransactWriteItems: balance debit +
      WithdrawalRequest + SellerLedgerEntry, same optimistic-lock pattern as grantTopup)
- [ ] Swap the remaining ~24 files calling `auth.api.getSession` / importing
      `@/server/auth` to `auth()` from `@/server/authDynamo` instead — done 2026-09-02 as
      part of the Content section's whole-app Auth.js cutover writeup below. `server/auth.ts`
      (better-auth) itself is now confirmed to have zero real live importers anywhere in
      the app; its remaining 5 importers are all independently-confirmed-dead files.
- [ ] `server/adminAuth.ts` (plexo-web's own admin allowlist check, separate from
      plexo-admin's `adminGuard.ts`) — verify it doesn't depend on better-auth internals
- [x] Password-based signup/login/reset flows — done 2026-09-02, see the Content section's
      Auth.js cutover writeup (`server/authDynamo.ts`'s new `Credentials` provider +
      `app/api/auth/{register,verify-email,forgot-password,reset-password}/route.ts`).

## Content (largest single context — Template 171 sites, TemplateAsset 25, BlogPost 24,
## BlogCategory 22, BlogTag 22, BlogSite 22, BlogAuthor 21, PublishedDomain 51, SiteLayout 13)

- [x] Done (2026-09-02) — the remaining ~90 dashboard/API/public-rendering files, ported in
      parallel across 4 concurrent agents plus direct follow-up work, closing out this
      entire bounded context (Blog, Templates lifecycle, Marketplace, public blog
      rendering tree, and the misc `app/api/v1/**` surface). `npx tsc --noEmit` is clean
      repo-wide.
  - **Blog & public rendering**: `lib/blog/{queriesDynamo,redirectsDynamo}.ts` extended
    (most twins — `savePostDynamo`, `authorsDynamo`, `pageAuthDynamo`, `adminAuthDynamo`,
    `revalidateDynamo`, `taxonomyDynamo` — already existed as side effects of earlier
    Commerce/MCP/Import work and just needed confirming + wiring), new
    `lib/blogImport/mediaRehostDynamo.ts` (fixed a live bug — `runBatchDynamo.ts` was
    calling the Prisma original), `lib/pub/blogArchivePageDynamo.tsx` (new, shared by the 6
    category/tag/author archive route files), `app/pub/[domain]/[[...slug]]/route.ts` (the
    main published-site router), the full `app/pub/[domain]/blog/**` tree (index,
    paginated, category/tag/author + their pagination siblings, feed.xml, sitemap.xml),
    `app/api/blog-og/[domain]/[...slug]/route.tsx`, `app/dashboard/blog/page.tsx`,
    `app/sitemap.ts`, `app/marketplace/[id]/page.tsx`. `lib/pub/resolveSite.ts` (the old
    Prisma version) is now fully orphaned in real app code.
  - **Templates lifecycle & marketplace**: convert-type/eject/reset-to-builder,
    script-access, snapshot, admin official-template toggle, marketplace
    listings/sell/preview/purchase, my-templates, public-templates, `lib/marketplace.ts`.
  - **v1 API misc**: ai/generate, analytics ×2, comments ×2 (added `CommentMention`
    entity usage + a documented bounded-Scan `findCommentById` since the client never
    sends templateId on PATCH/DELETE), compile, domains/verify, media ×3,
    notification-preferences, notifications, organizations/active/members, profile,
    validate-key. `lib/credits/ledger.ts`'s only non-duplicated function
    (`estimateWorstCaseCost`) moved into `lib/db/ledgerOperations.ts`; the rest was already
    a live duplicate with zero real callers left.
  - **Testimonials/Pusher/Webhooks + orphan sweep**: pusher/auth, testimonials ×3 (with a
    real split-brain fix — `app/api/public/forms/[templateId]/submit/route.ts` was writing
    `FormSubmission` via Prisma while the dashboard inbox already read it from DynamoDB),
    Plexo's own SaaS-billing Stripe webhook. Confirmed genuinely dead (zero real
    importers): `server/{siteTransfer,templateName}.ts`, `lib/siteLayout.ts`,
    `lib/blog/{adminAuth,authors,pageAuth,revalidate,savePost}.ts`,
    `lib/blogImport/{mediaRehost,redirects,runBatch,taxonomy}.ts`,
    `lib/commerce/{adminAuth,cart,digitalDelivery,orderFulfillment,wallet}.ts`,
    `lib/commerceRateLimit.ts`, `lib/siteImport/{adminAuth,assetInternalize,linkRewrite,
    runJob}.ts`, `app/api/v1/_lib/apiKeyAuth.ts`.
  - **Found and fixed along the way (not in any batch's original list)**: a real,
    previously-undiscovered live gap — `lib/commerce/digitalDeliveryDynamo.ts` (the
    already-"done" Commerce digital-delivery resend flow) was still importing
    `resolveSitePublicUrl` from the Prisma-only `lib/commerce/siteUrl.ts`, meaning resend
    emails would have queried Postgres for the seller's domain. New
    `lib/commerce/siteUrlDynamo.ts` extracted from `commerceWebhookOperations.ts`'s own
    private copy of the same function (deduplicating it), both callers repointed.
    `app/dashboard/pages/page.tsx` (a whole dashboard route no batch had been assigned)
    ported directly. Three more previously-undiscovered live Prisma routes surfaced by
    tracing every real importer of the legacy `resolveUser` re-export in
    `app/api/v1/domains/route.ts`: `app/api/v1/site-import/detect/route.ts`,
    `app/api/v1/marketplace/templates/[id]/route.ts`, `app/api/templates/[id]/pages/route.ts`
    (the last needed nothing new — `server/slugDynamo.ts`'s `getPageTree` already existed,
    correct, just never wired to its own route).
  - **The whole-app Auth.js cutover, done properly, not deferred**: tracing every real
    importer of `@/server/auth` down to zero (see above) meant the ONLY thing left still
    depending on better-auth was the login handler itself
    (`app/api/auth/[...all]/route.ts`) and `middleware.ts`'s dashboard session-cookie
    check — plus `lib/auth-client.ts` and its 9 client-side callers, which were still
    100% better-auth's client SDK. This was a real, previously-undocumented finding: every
    dashboard/API route ported across this ENTIRE migration had already been reading
    sessions via `server/authDynamo.ts`'s `auth()`, but nothing could ever have actually
    produced a session Auth.js could read, since login still ran through better-auth's
    incompatible session mechanism — meaning no ported page was reachable via a real login
    on this branch until this was fixed. First attempt flipped only the route handler and
    got reverted immediately (breaks password login/signup/reset outright — no Credentials
    provider existed yet, and `lib/auth-client.ts`'s email/password/reset calls have no
    Auth.js counterpart). Done properly instead:
    - `lib/db/coreEntities.ts`'s `User` gained 4 additive fields — `passwordHash`,
      `isConfirmed`, `suspendedAt`, `suspendedReason` — matching plexo-admin's identical
      addition to this same physical table's User records (schemaless, no redeploy).
    - `server/authDynamo.ts` gained a `Credentials` provider (`@better-auth/utils/password`'s
      `verifyPassword` — the same scrypt-based library better-auth itself used, so every
      existing `passwordHash` still validates) alongside Google, plus a
      `dynamoAdapter` export reused by 4 new routes. Verified directly against
      `@auth/core`'s own `assert.js` that `session:{strategy:"database"}` + Credentials is
      only valid with at least one non-Credentials provider also configured — true here
      (Google) — before relying on it.
    - New `app/api/auth/{register,verify-email,forgot-password,reset-password}/route.ts` —
      replace better-auth's built-in signUp.email/verify-email/forgetPassword/resetPassword
      server-side handling. Verification/reset tokens reuse `@auth/dynamodb-adapter`'s own
      `createVerificationToken`/`useVerificationToken` methods (a real generic token store
      already on the adapter instance) rather than a bespoke entity.
    - New `app/api/org/route.ts` (GET) — replaces `authClient.organization.list()`;
      `/api/org/active` (already existed) covers `setActive`.
    - `lib/auth-client.ts` rewritten on `next-auth/react`'s `signIn`/`signOut` + the above
      routes, preserving the exact call shape all 9 existing callers already used
      (`authClient.signIn.email/social`, `.signUp.email`, `.signOut`, `.forgetPassword`,
      `.resetPassword`, `.organization.list/setActive`) so none of those files' own logic
      needed to change — only the now-unnecessary `as any` casts were removed. One real
      subtlety fixed here: `next-auth/react`'s `signIn()` splits a thrown `CredentialsSignin`
      into `error` (always the generic `"CredentialsSignin"` type string) and a separate
      `code` field (the actual reason) — the "account not verified" 403 UX branches on
      `code`, not `error`.
    - `middleware.ts`'s dashboard session-cookie check flipped from better-auth's
      `session_token` convention to Auth.js's default `authjs.session-token` — the other
      landmine that would have silently broken every dashboard page's auth *redirect* even
      with the handler itself correctly flipped.
    - `.env`: added `AUTH_SECRET` (generated). `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
      remain genuinely unset (pre-existing gap, not introduced this pass — real Google
      OAuth credentials need to be created in Google Cloud Console, an external action).
    - **Not verified against a real running server/browser** — no dev server was started
      this session. Verification so far is `tsc --noEmit` (clean) plus manually tracing
      `@auth/core`'s actual source for the database+Credentials validation rule and the
      adapter's verification-token methods. Recommend a real login/signup/reset smoke test
      before trusting this in staging.
- [ ] **Customer domain publishing has no AWS equivalent built yet** — `app/api/v1/domains/route.ts`'s
      `addVercelDomain`/`removeVercelDomain` call Vercel's Domains API, which auto-issues a
      cert for any customer domain pointed at it with zero extra DNS step from the
      customer. Plain CloudFront has no equivalent (one cert per distribution, no
      automatic per-domain issuance). Confirmed via real AWS docs (not guessed): **CloudFront
      SaaS Manager** (GA April 2025) is the purpose-built replacement — `AWS::CloudFront::
      DistributionTenant` + `ManagedCertificateRequest` gives each customer domain its own
      auto-validated (HTTP, no manual customer DNS step), auto-renewed ACM cert, up to 2,000
      domains per multi-tenant distribution. Pricing: first 10 tenants free, then $20/mo
      flat up to 200, $0.10/tenant past that — factor into the $500/year budget once past
      10 total published domains. User confirmed (2026-09-01): build on CloudFront SaaS
      Manager, not deferred. Blocked on the Content cutover above landing first — a
      multi-tenant distribution needs a real published-site rendering path (reading
      `PublishedDomain`/`Template` from DynamoDB) to point tenants at; building the tenant
      plumbing before that exists would have nothing real to serve. Sequence: (1) Content
      cutover's `app/[domain]/**` rendering path first, (2) then a new `cdk/lib/
      published-sites-stack.ts` — multi-tenant `AWS::CloudFront::Distribution` + connection
      group, wired to that rendering Lambda, (3) then swap `addVercelDomain`/
      `removeVercelDomain` in `app/api/v1/domains/route.ts` for `CreateDistributionTenant`/
      `DeleteDistributionTenant` calls.

## Commerce (CommerceProduct 33, CommerceSettings 31, CommerceOrder 27, CommerceCartItem 10,
## CommerceDiscountCode 13, CommerceWallet 14, CommerceAvailabilityRule/Exception 14, etc.)

- [x] Done (2026-09-02) — the entire bounded context, ~40 files: admin CRUD (settings,
      products/categories, discounts, availability, orders + refund, customers, wallet +
      withdrawals, Stripe-access request), the full public storefront (products, product
      detail, availability, cart x3, checkout x2 — see `lib/commerce/checkoutDynamo.ts`'s
      real `TransactWriteItems` port of the stock/discount/slot-claim transaction, digital
      delivery, newsletter, order lookup), all 3 webhooks (per-site Paystack — wired the
      `commerceWebhookOperations.ts` foundation that already existed but wasn't wired into
      a live route; platform Paystack; platform Stripe), the internal expire-stale-holds
      cron, both MailDrip connect routes, all 8 dashboard pages + the site-switcher layout,
      and `lib/mcp/commerceTools.ts`. Old Prisma helpers now fully orphaned:
      `lib/commerce/{cart,orderFulfillment,wallet,digitalDelivery,adminAuth}.ts`.
  - Found and fixed a real pre-existing bug in `lib/db/commerceEntities.ts` while porting
    the wallet page: `CommerceWithdrawalRequest.status` was typed
    `PENDING|APPROVED|REJECTED`, but the actual Prisma schema's `CommerceWithdrawalStatus`
    enum is `PENDING|PROCESSED|REJECTED` (verified directly against `prisma/schema.prisma`,
    not assumed) — `CommerceStripeAccessStatus`/`CommerceReviewStatus` really do use
    APPROVED, so this wasn't a copy-paste-everywhere mistake, just this one entity. Fixed
    at the source; caught via a real `tsc` type error, not spotted by inspection.
  - Two genuinely new indexless-access-pattern gaps, both handled the same documented
    "honest Scan for a low-frequency job" way as `scan-domains`/`resume-stalled`:
    `expire-stale-holds` (no cross-site status index on CommerceOrder) and the platform
    Stripe webhook's order lookup (no `stripeCheckoutSessionId` index at all — acceptable
    since PLATFORM_STRIPE is a staff-approval-gated, low-volume path).
  - `CommerceProduct`/`CommerceCategory` are id-keyed, not slug-keyed (unlike
    BlogPost/BlogCategory) — every slug/name lookup fans out over the site's own
    product/category list in memory rather than a direct `.get()`.
  - `lib/pub/resolveSiteDynamo.ts` — new. `resolveSite`/`resolveBlogSite` were Prisma-only
    and shared by 25 files (the entire public rendering tree + every Commerce public
    route) — only the Commerce callers were repointed to the new file; the blog rendering
    tree stays on the Prisma original until Content's own rendering-path phase (see below).
  - `server/siteTransfer.ts` was found along the way, unblocked now that every Commerce
    entity it touches exists, and ported next as its own pass — see the Import section's
    SiteTransferRequest entry for the full writeup. `app/api/v1/templates/[id]/route.ts`
    (the public v1 GET/PUT/DELETE, entirely
    separate from the dashboard's own `app/api/templates/[id]/route.ts`) was a real
    previously-undiscovered split-brain gap found via grep for `lib/siteLayout` callers —
    fixed this pass since it was a direct, cheap consequence of already porting
    `lib/siteLayoutDynamo.ts`.

## Import (SiteImportJob 22, ImportJob 16, SiteImportPage 7, SiteTransferRequest 14)

- [x] ImportJob (blog/WordPress import) — done earlier this session
      (`lib/blogImport/runBatchDynamo.ts` + callers)
- [x] SiteImportJob/SiteImportPage/SiteImportAssetBlob (whole-website crawl-and-clone) —
      done 2026-09-01: `lib/siteImport/runJobDynamo.ts` (port of `runJob.ts`),
      `lib/siteImport/adminAuthDynamo.ts`, `lib/siteImport/assetInternalizeDynamo.ts`
      (content-addressed asset cache, `.create()` + swallow the race's
      `ConditionalCheckFailedException` rather than Prisma's `upsert`),
      `lib/siteImport/linkRewriteDynamo.ts` (signature gained an explicit `jobTemplateId`
      param — BlogPost has no bare-id index in DynamoDB, unlike Prisma's globally-unique
      id, so resolving "this blog post" needs the site's templateId to know which
      partition to search). All 6 API routes repointed
      (`app/api/v1/site-import/[templateId]/**`,
      `app/api/internal/site-import/{process,resume-stalled}/route.ts` — the latter's
      cross-org "every non-terminal job" sweep has no index (SiteImportJob only has
      primary+byOrg), so it's a bounded `.scan`, same reasoning as `scan-domains`'s
      PublishedDomain scan). The old Prisma versions of all 4 lib files now have zero
      remaining callers.
- [x] `SiteTransferRequest` / `server/siteTransfer.ts` — done 2026-09-02, now that Commerce
      landed. New `lib/siteTransferDynamo.ts` ports `collectSiteTemplateIds` (BFS over
      Template's `byParent` GSI2 instead of Prisma's `parentId: {in: frontier}`),
      `computeTransferWarnings`, and `executeSiteTransfer`. The reassignment is
      deliberately **not** a single atomic transaction (unlike Commerce's checkout, which
      genuinely needs one) — DynamoDB has no transaction spanning this many item types
      (13+ Template/Commerce/Comment/SiteImportJob rows), and a partial failure here is a
      recoverable data-hygiene issue (some rows still show the old org, caught by the
      "re-grep every cut-over entity" standing check), not a security hole, since every
      real read path already scopes by templateId/organizationId together. Every
      `CommerceProductRelation` reassignment fans out per-product (its real key,
      `productId`+`relatedProductId` — matches the entity's own documented access
      pattern), not a templateId scan.
  - Wired all 6 surrounding files: `app/api/templates/[id]/transfer/route.ts` (also fixed
    a split-brain bug — it was importing the stale Prisma-backed `resolveUser` re-export
    from `app/api/v1/domains/route.ts` instead of the real `lib/auth/resolveUser.ts` used
    by every other Dynamo-ported v1 route), `app/api/site-transfers/route.ts`,
    `app/api/site-transfers/[id]/respond/route.ts`, `app/dashboard/transfers/{page,
    [id]/page}.tsx`.
  - `SiteTransferRequest`'s primary key is (templateId, id) with only a `byToken` GSI (see
    `lib/db/importEntities.ts`'s own comment) — but the dashboard list/detail/respond
    routes only ever have the bare transfer `id` or the caller's email/orgId, never the
    templateId. Added `findTransferById`/`listIncomingTransfers`/`listOutgoingTransfers`
    as genuine bounded Scans, same discipline as `scan-domains`/`resume-stalled`/
    `expire-stale-holds` — a site transfer is a rare, non-TTL'd business action, not a
    hot path, so this doesn't need a speculative GSI3.
  - Deliberately **not** reassigned during a transfer (flagged, not silently dropped):
    `PaystackWebhookEvent` (`lib/db/ledgerEntities.ts`) — keyed by bare id with only a
    `byOrg` GSI used for a support/debug listing; reassigning it would mean a full scan of
    the shared ledger table for a field with zero security/authorization impact.

## Ops (PageView 6) + platform-wide (User.adminRole-gated routes, Testimonial,
## ScriptAccessRequest, PlatformSettings, Notification/NotificationPreferences)

- [x] Done 2026-09-02, as part of the Content section's parallel pass — Testimonial
      (`app/api/testimonials/**`), ScriptAccessRequest
      (`app/api/v1/templates/[id]/script-access/route.ts`), PlatformSettings (already
      live via the marketplace/publish routes from an earlier session),
      Notification/NotificationPreferences (`app/api/v1/notifications/route.ts`,
      `app/api/v1/notification-preferences/route.ts`, `lib/notificationPreferencesDynamo.ts`).

## plexo-admin (separate app, /Users/kunmi/Documents/Personal/plexo-admin — staff-facing,
## reads the SAME physical DynamoDB tables as plexo-web, own repo/branch/deploy)

- [x] DynamoDB foundation built from scratch 2026-09-02 (this repo had zero prior Dynamo
      work): `lib/db/{coreEntities,contentEntities,commerceEntities,ledgerEntities,
      importEntities,opsEntities}.ts` (byte-for-byte copies of plexo-web's own — same
      physical tables, must stay schema-identical — plus 4 additive `User` fields this
      repo needs that plexo-web's own schema didn't yet have: `passwordHash`,
      `isConfirmed`, `suspendedAt`, `suspendedReason`; plexo-web's `coreEntities.ts` picked
      up the same 4 fields the same day for its own Credentials-provider cutover, see
      above — keep both copies in sync going forward), `lib/db/client.ts` (env vars:
      `PLEXO_{CORE,LEDGER,COMMERCE,CONTENT,OPS,IMPORT}_TABLE`, `AWS_REGION`).
  - **Auth**: replaced better-auth+Prisma with NextAuth v5, a `Credentials` provider, and
      **JWT session strategy with no adapter** (deliberately — an adapter would write
      plexo-admin's own session/account rows into plexo-web's live customer session store
      in the shared `plexo-core` table). Password verification reuses the same
      `@better-auth/utils/password` `verifyPassword` plexo-web's own Credentials provider
      now uses. `adminRole` is checked live via `User.get()` on every request, not cached
      in the JWT, preserving "revocation takes effect next request."
  - **Infra/CDK changes identified but deliberately NOT made** (flagged for a human,
      matches this checklist's own discipline for plexo-web's pending GSI2 redeploy):
      plexo-admin's Lambda needs the same 6 `PLEXO_*_TABLE` env vars + `AWS_REGION`
      injected, and its execution role needs cross-stack/cross-account IAM read/write on
      plexo-web's 6 tables and their GSIs (these tables are provisioned by plexo-web's own
      CDK stack). A new `AUTH_SECRET` SSM parameter also needs provisioning.
  - **Ported**: Users, Organizations, Settings, session, the `app/api/auth/[...all]`
      handler, and plexo-admin's own cross-account "move a site between users" support
      tool (`app/api/migrations/{preview,commit}/route.ts` + `lib/siteMigration.ts` — this
      is NOT the Postgres→DynamoDB data migration itself, confirmed by reading both fully).
  - **Known regression, not solved this pass**: the Users list dropped its Sites/Domains
      count columns — `Template`/`PublishedDomain` have no `byUser` index (only
      `byOrg`/`byParent` and `byDomain` respectively), and a full-table scan on every list
      render was rejected as too expensive. The Users *detail* page still shows counts via
      a bounded per-user scan (rare, on-demand). Needs a future `Template.byUser`/
      `PublishedDomain.byUser` GSI or a denormalized counter.
  - **Commerce-withdrawals, Commerce-stripe-access-requests, Withdrawals, Marketplace
      (admin side)** and **Domains, Testimonials, ScriptAccessRequests, Feedback,
      Analytics** — done 2026-09-02, two parallel follow-up passes. `npx tsc --noEmit` is
      clean and `grep -rl "@/server/prisma"` across `app/lib/server` now returns **zero
      files** — the entire plexo-admin app is cut over, only `server/prisma.ts`/`prisma/`
      themselves remain (dead weight for the eventual cross-cutting cleanup).
  - New invented pattern (no plexo-web precedent existed for this): `WithdrawalRequest`/
    `CommerceWithdrawalRequest`/`CommerceStripeAccessRequest` are keyed by userId/walletId/
    organizationId, but their admin approve/reject routes only ever receive a bare `id` —
    resolved via each entity's `byStatus` GSI1 (bounded to the pending-queue size, not a
    full scan) rather than adding a new index. Withdrawal **rejection** (both kinds) uses
    a real `TransactWriteCommand` (balance reversal + status flip + ledger entry,
    all-or-nothing) — real money, no partial-failure tolerance.
  - `ScriptAccessRequest` approve/reject needed its real `(templateId, id)` key but the
    routes only had `id` — threaded `templateId` through from the already-known list-page
    query results into the client action component's fetch body, instead of adding a
    bounded scan (cheaper, and avoids a new indexless-access-pattern precedent).
  - `lib/analytics.ts` (Overview dashboard, likely the most-visited admin page) — `PageView`
    has no cross-template index at all, so every breakdown (daily views, device/browser/OS,
    top sites, risky-domains, audit activity, marketplace summary) shares **one** bounded
    scan per time window via an in-flight-request cache, rather than one scan per metric.
    Flagged for follow-up if real traffic volume ever makes this too slow.
  - Real split-brain caught mid-pass: `app/(dashboard)/page.tsx` wasn't in either agent's
    named file list, but is `lib/analytics.ts`'s sole caller and had 5 of its own direct
    `prisma.count()` calls — ported anyway rather than leaving a half-Dynamo, half-Prisma
    page, exactly the failure mode this checklist's own opening warning describes.
  - `app/api/marketplace/bulk/route.ts`'s bulk delete now explicitly deletes each listing's
    `TemplateAsset` rows before the `Template` itself — DynamoDB has no cascade delete the
    way the Prisma original relied on; a real behavior addition, not just a port, to avoid
    orphaning asset rows.

## Cross-cutting, do once the above land

- [ ] Delete `server/auth.ts`, `server/org.ts`, `server/requirePermission.ts`,
      the `better-auth`/`@better-auth/prisma-adapter` deps (plexo-web only — plexo-admin's
      own better-auth deps are already unused, not yet removed either), and `prisma/`
      itself — only after every call site above is confirmed swapped (grep for
      `@/server/prisma` and `@/server/auth` returning zero results is the exit condition
      for this whole checklist). As of 2026-09-02, `@/server/auth` has zero real live
      importers left in plexo-web — only independently-confirmed-dead files still import
      it — so this is now safe to schedule, not blocked on anything else.
- [ ] Run `scripts/migration/backfillCore.ts` + `backfillAuthUsers.ts` for real (staging
      first, per the agreed plan), then extend the same pattern to the remaining ~58 models
- [ ] Parallel-run / shadow-read validation between Postgres and DynamoDB before any
      production traffic switch
- [ ] **Smoke-test the Auth.js cutover against a real running server/browser** before
      trusting it in staging — login (Google + email/password), registration + email
      verification link, forgot/reset password, sign-out, and the org switcher all changed
      this session and were only verified via `tsc --noEmit` + manual tracing of
      `@auth/core`'s source, never a live request.
