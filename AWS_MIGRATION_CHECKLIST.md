# Plexo → AWS DynamoDB Migration Checklist

Tracks the build against the roadmap. Covers `plexo-web` and `plexo-admin` together — they
share every DynamoDB table, so their cutover is one event, not two.

Deliberately diverging from Maildrip's CDK pattern in three ways: OpenNext for compute
(Maildrip runs the whole Next.js server in one Lambda with no ISR/image-optimization
pipeline), one focused stack per concern instead of one file mixing compute+DNS+CDN, and
OIDC instead of static IAM keys for CI (already shipped below).

---

## Phase 0 — AWS Foundation & CI

- [x] Create dedicated AWS account (`Plexo`, `919927637684`, `plexo@charisol.io`) under the Charisol org
- [x] Grant SSO access (AdministratorAccess permission set) to the account
- [x] Bootstrap the account for CDK (`us-east-1`)
- [x] Scaffold `plexo-web/cdk/` (bin/app.ts + lib/, matching Charisol's CDK shape)
- [x] Deploy `plexo-core`, `plexo-ledger`, `plexo-commerce`, `plexo-content`, `plexo-ops`, `plexo-import` DynamoDB tables
- [x] Create GitHub OIDC provider + `github-actions-plexo-deploy` IAM role, trust-scoped to `repo:Challaris/plexo-web:*` and `repo:Challaris/plexo-admin:*` — no static keys
- [x] Add customer-managed KMS key for `plexo-ledger` table encryption (rotating key, `alias/plexo-ledger` — in-place update, confirmed via `cdk diff` before deploying)
- [x] Confirm `github-actions-plexo-deploy` role's permission scope is sufficient for future stacks — it assumes `deploy-role`, which only orchestrates CloudFormation changesets; actual resource creation runs through `cfn-exec-role` (AdministratorAccess from bootstrap), so every future stack is already covered by design, nothing to extend
- [x] Set CloudWatch log retention convention (`cdk/lib/conventions.ts`, `DEFAULT_LOG_RETENTION` = 30 days) — ready for Phase 6's Lambdas to use, since none exist yet to apply it to directly

## Phase 0.5 — PR preview lifecycle (CI/CD)

- [x] Fix table/KMS-alias naming to be environment-scoped (production keeps its literal names; every other environment gets a `-${STACK_ID}` suffix) — verified via `cdk diff` showing zero changes to production before and after
- [x] Deploy a persistent `staging-plexo` data stack (one shared staging table set — PR previews point at this, they don't each provision their own tables)
- [x] Split `bin/app.ts` into `STACK_KIND=data` (production/staging tables, never touched by PR workflows) vs `STACK_KIND=compute` (per-PR previews) so there's no code path by which a PR workflow could reach the data stack
- [x] `pr-deploy-aws.yml` — deploys `pr-<n>-plexo-compute-stack` on PR open/reopen/sync, via OIDC, with a hard regex guard on the stack ID and `--exclusively` (never `--all`)
- [x] `pr-destroy-aws.yml` — destroys on PR close, verifies actual CloudFormation deletion (waits on `DELETE_IN_PROGRESS`, fails loudly on `DELETE_FAILED`), cleans up orphaned IAM roles
- [x] `pr-stale.yml` — daily sweep, tears down any preview idle 5+ days (PR stays open, only the AWS resources go)
- [x] Proved the full deploy → verify → destroy lifecycle locally against the placeholder compute stack before trusting it to CI
- [ ] Push these workflows to `Challaris/plexo-web` and confirm a real PR actually triggers them correctly (can't verify from local `cdk` calls alone — needs GitHub itself to run it)

## Phase 1 — Auth.js (DynamoDB-native) spike

Revised mid-phase: switched from WorkOS to `@auth/dynamodb-adapter` (self-hosted, no
external vendor in the login path) — see `docs/auth-migration-design.md` for the full
reasoning. A WorkOS API key was pasted into chat during the original setup; it was never
used for anything and should be treated as compromised (rotate/revoke in the WorkOS
dashboard regardless of not using WorkOS anymore).

- [x] Decide how identity (Auth.js's adapter-managed `User`/`Account`/`Session`) and business data (our own `User`/`Organization`/`Member`) fit together — same `id`, same `plexo-core` table, no foreign-key-to-external-system field needed — `docs/auth-migration-design.md`
- [x] Confirm `accessControl.ts`'s permission ladder survives the migration unchanged — framework-agnostic already, only what supplies the role string changes
- [x] Remove the WorkOS webhook route and its SSM parameters — no longer needed, there's no external system to mirror from
- [x] Add `next-auth@5.0.0-beta.32` (verified against the actual Next.js 16 peer-dependency range, not the stale beta.25 first tried) + `@auth/dynamodb-adapter`, resolved a real `nodemailer` peer conflict against the project's existing 9.x pin via the same `overrides` pattern already used for `openai`/`zod`
- [x] Write `server/authDynamo.ts` (Google provider + `DynamoDBAdapter` config, verified against the adapter's real docs) — scaffolded separately from the live `server/auth.ts`, not wired in yet, so today's production better-auth setup isn't touched before Phase 8
- [x] Type-checked clean against the full project `tsconfig.json` — caught and fixed a real `DynamoDBDocument` vs `DynamoDBDocumentClient` type mismatch (the adapter needs the former) and two `possibly undefined` balance-field errors in `ledgerOperations.ts`
- [x] SSM parameters updated: `/plexo/{staging,production}/AUTH_SECRET` (placeholder, replacing the removed WORKOS_* ones), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` unchanged since Google OAuth is still needed
- [ ] **Blocked on you** — create the Google Cloud OAuth client (Web application type) for Google login — the only external account this still needs
- [ ] Once that exists: generate a real `AUTH_SECRET`, add it + Google credentials as GitHub secrets, run `sync-secrets-to-ssm.yml`, then stand up the organizations/members/invitations flow and prove parity with better-auth's `organization` plugin
- [ ] Port `server/adminGuard.ts`'s role-check pattern to read `adminRole` off the DynamoDB User item

## Phase 2 — `plexo-core` + `plexo-ledger`

- [x] Define ElectroDB entities: User (added — needed by ledger ops, wasn't in the original scope), Organization, Member, ApiKey, UploadedImage, PlatformSettings, Notification, NotificationPreferences (`lib/db/coreEntities.ts`) — every field ported 1:1 from the real `schema.prisma`, not assumed
- [x] Define ElectroDB entities: CreditLedgerEntry, SellerLedgerEntry, WithdrawalRequest, StripeEvent, PaystackWebhookEvent (`lib/db/ledgerEntities.ts`)
- [x] Port `grantTopup` and the shared allowance/topup debit path (`chargeFlatCredits`) — `lib/db/ledgerOperations.ts`. Real architectural difference from Postgres surfaced and solved: `TransactWriteItems` can't return post-write values the way a Postgres `$transaction` can, so `balanceAfter` uses an optimistic-concurrency read-then-conditional-write-with-retry pattern instead of a naive port
- [x] Verified by actually type-checking all five new files (`tsc --noEmit`) — caught and fixed three real bugs in the first draft (`.get()`'s item typing, `.where()`'s condition-combining syntax, `.params()`'s type gap against `TransactWriteCommand`) rather than assuming the code was correct
- [x] Build the DynamoDB Streams → Lambda outbox handler (`lib/db/ledgerStreamHandler.ts`) — scoped to the concrete real need (decoupling a Paystack transfer call from the synchronous "mark withdrawal processed" write, with idempotency against stream redelivery), not built speculatively
- [x] Confirm GSI1 patterns per entity — documented inline at each entity's index definition, matching the original Prisma `@@index`/`@unique` the entity is replacing
- [ ] Port `chargeUsage` (real token-usage pricing) and `ensureCreditPeriod` (monthly allowance grant) — same TransactWrite pattern as `grantTopup`/`chargeFlatCredits`, not new design, deferred as app-integration work
- [ ] Wire `lib/db/ledgerStreamHandler.ts` as a real Lambda + event source mapping once Phase 6 exists (currently a correct, type-checked handler with nowhere to run yet)
- [ ] `TODO(Phase 3)`: implement the actual Paystack transfer call inside the stream handler — intentionally not fabricated

## Phase 3 — `plexo-commerce`

- [x] Define ElectroDB entities: CommerceCategory, CommerceProduct, CommerceCart(+Item), CommerceOrder(+Item), CommerceBooking, CommerceDiscountCode, CommerceAvailabilityRule(+Exception), CommerceProductReview (`lib/db/commerceEntities.ts`) — every field ported 1:1 from the real schema, GSI1 picked per-entity for its actual operational access pattern (payment-ref lookup for orders, cart-token lookup for carts, code lookup for discounts, product-scoped for availability/reviews) rather than defaulting to org-wide everywhere
- [x] Added `CommerceBookingSlotLock` — not in the original scope, but required: Prisma's `@@unique([productId, scheduledStart])` no-double-booking constraint has no DynamoDB GSI equivalent (GSIs don't enforce uniqueness, only a table's own primary key does), so it needs a companion lock item whose primary key IS the slot
- [x] Confirm every checkout/booking write path stays inside one `TransactWriteItems` call — `lib/db/commerceOperations.ts`'s `createBookingOrder` demonstrates the real pattern (order + item + booking + slot-lock, one transaction, the lock's implicit condition fails the whole thing atomically on a double-booking attempt)
- [x] Verified by type-checking against the full project (`tsc --noEmit -p tsconfig.json`) — zero errors project-wide, not just in the new files
- [x] **Gap closed**: `CommerceOrder` now has GSI2 for order-number lookup (customer order-tracking) — added a `secondGsi` flag to the CDK table spec, verified via `cdk diff` that it only touched the Commerce table (in-place update) before deploying to both production and staging. `customerEmail` search deliberately stays off a dedicated GSI, routed through the existing Athena/export path instead (an occasional admin-support query, not a latency-sensitive one)
- [x] **Deferred item fixed**: ported the real Paystack webhook confirmation flow (`lib/db/commerceWebhookOperations.ts`) from `app/api/webhooks/paystack/[templateId]/route.ts` + `lib/commerce/orderFulfillment.ts` + `lib/commerce/digitalDelivery.ts` — idempotency claim, atomic PENDING→PAID transition, booking confirmation, and real (not stubbed) idempotent digital-delivery record creation, all against the new tables
- [x] Added two entities not in the original scope, both hard blockers for the webhook to function at all: `CommerceSettings` (the webhook's first read — identifies the site and its Paystack keys before a signature can even be checked) and `CommerceDigitalDelivery` (idempotent digital delivery, same primary-key-is-the-constraint pattern as the booking slot-lock)
- [x] Adjusted `CommerceBooking`'s sort key to `orderId` (a valid natural key — real 1:1, `orderId` unique) instead of `id`, so "find this order's booking" during webhook confirmation is a direct lookup, not another GSI
- [x] Caught a real bug in my own first draft while type-checking: `holdExpiresAt: null` to clear a field isn't valid ElectroDB — needs `.remove([...])`, not `.set({...: null})` — fixed and reverified clean
- [ ] **Honest remaining gap**: two calls are marked `TODO(Phase 4)` rather than faked — the payment-received email and the digital-delivery email both need `Template` (site name) and `PublishedDomain` (site public URL for email links), neither of which exists as DynamoDB code yet. Everything up to and including "should this email send, and to whom" is real; the actual send is correctly gated behind Phase 4

## Phase 4 — `plexo-content` + `plexo-import`

- [x] Define ElectroDB entities: Template, TemplateRevision, TemplateGenerationJob, TemplatePurchase, TemplateAsset, Testimonial, PublishedDomain (`lib/db/contentEntities.ts`) — 17 entities total, every field ported 1:1 from the real schema
- [x] Define ElectroDB entities: BlogSite, SiteLayout, BlogAuthor/Category/Tag/Post(+relations)/Comment/Redirect
- [x] Define ElectroDB entities: ImportJob, ImportMediaMap, SiteImportJob/Page/AssetBlob, SiteTransferRequest (`lib/db/importEntities.ts`) — all TTL-tagged (90 days) except `SiteTransferRequest`, which is a real business action with its own audit trail, not disposable job state
- [x] Added `Template`'s GSI2 as a real CDK change (`secondGsi` flag, same mechanism as Commerce's) — verified via `cdk diff` it only touched the Content table, deployed to production and staging
- [x] Nine `@@unique` Prisma constraints moved into primary sort keys instead of spent on GSIs (asset path, purchase templateId, author/category/tag/post slug, redirect fromPath, media-map sourceUrl, import-page sourceUrl, asset-blob sha256) — same discipline as the booking slot-lock and digital-delivery record from Phase 3
- [x] **Both Phase 3 TODOs resolved for real**: `lib/db/commerceWebhookOperations.ts`'s payment-received email and digital-delivery email are now fully ported, not stubbed — `resolveSitePublicUrl` ported against the new `PublishedDomain` entity, site name pulled from the new `Template` entity, all four email builders wired with real content
- [x] Verified `notifyMaildripOfPaidOrder` (and its `sendReceiptEmail`/`tagContactIntoGroup` helpers) never touched Prisma to begin with — reused directly rather than re-ported, with a documented type-cast bridging Prisma's generated types and our ElectroDB item shapes at the two call sites
- [x] Type-checked clean against the full project tsconfig after every change
- [ ] **Confirmed, not guessed**: no real Paystack transfer integration exists anywhere in the current codebase to port — `lib/db/ledgerStreamHandler.ts`'s `TODO(Phase 3)` marker was correctly scoped from the start, not deferred out of laziness. Still open, needs real product/business scoping before it's buildable
- [ ] Known gaps carried forward, documented not hidden: `Template`'s marketplace-status browsing (candidate for Athena/export), `BlogPost`'s externalId-based import dedup, `SiteTransferRequest`'s toEmail lookup — each is real but didn't earn a GSI over the higher-traffic pattern that got one (TTL-tagged)

## Phase 5 — `plexo-ops` + `plexo-admin` cutover

- [x] Define ElectroDB entities: PageView, RateLimit, StockCache, AdminAuditLog, FormSubmission (`lib/db/opsEntities.ts`)
- [x] **Real design correction**: `AdminAuditLog` and `FormSubmission` don't actually get a `ttl` value despite living in the "TTL-heavy by design" table — they're a compliance trail and real business leads, not disposable data. DynamoDB's TTL is opt-in per item even though the table designates one attribute name for it, so this costs nothing to fix.
- [x] Built the monthly DynamoDB → S3 export for real (`cdk/lib/analytics-stack.ts`): S3 export bucket (1-year lifecycle), a small scheduled Lambda calling `ExportTableToPointInTime` for core/commerce/content (ledger deliberately excluded — financial data has its own audit path), Athena workgroup + Glue database. Deployed to production and staging as a new `STACK_KIND=analytics`.
- [x] **Actually invoked the export Lambda rather than assume it worked — it didn't, at first**: `PointInTimeRecoveryUnavailableException`, because `ExportTableToPointInTime` requires PITR on the *source* table, and only `plexo-ledger` had it enabled. Fixed by enabling PITR on Core/Commerce/Content too (verified in-place via `cdk diff`, deployed, confirmed PITR active, re-invoked — real export ARNs returned, confirmed `IN_PROGRESS`)
- [x] Walked every `plexo-admin` route against what actually exists:
  - **Covered by a real GSI**: withdrawals (`WithdrawalRequest.byStatus`), testimonials (`Testimonial.byStatus`), settings (`PlatformSettings` singleton)
  - **Found two models referenced by real admin routes that no phase had scoped**: `ScriptAccessRequest` and `Feedback` — added both to `lib/db/contentEntities.ts`, each with a `byStatus` GSI matching their admin review-queue use
  - **Genuine Athena/export candidates, not oversights**: organizations and users admin browse/search (no "list everything" GSI exists or should — that's exactly what the export path is for), marketplace browsing (already flagged in Phase 4), platform-wide analytics aggregation (PageView's primary key is per-site, cross-site aggregate reporting is Athena's actual job), domain moderation/abuse review (`PublishedDomain` spent its one GSI on the hot middleware hostname-resolution path, correctly — flagged review queues aren't latency-sensitive)
- [ ] Deploy `plexo-admin`'s own compute stack alongside `plexo-web`'s — depends on Phase 6 existing first

## Phase 6 — Compute & Edge (OpenNext)

- [x] **Built and actually deployed, not just written**: `cdk/lib/compute-stack.ts` is a real OpenNext pipeline — SSR Lambda, image-optimization Lambda, S3 static assets, SQS revalidation queue, DynamoDB ISR tag-cache table, CloudFront with the exact behaviors OpenNext's own build manifest specifies
- [x] Ran `npx @opennextjs/aws build` for real against the actual `plexo-web` app — succeeded (`next build` succeeded too, despite the app not yet running against DynamoDB) — and used the **real output** (`open-next.output.json`, plus the package's own unminified source under `node_modules/@opennextjs/aws/dist/overrides/`) to get exact bundle paths, CloudFront behaviors, and env var contracts, after documentation scraping proved unreliable
- [x] Lambda Function URLs (`AWS_IAM` auth) + CloudFront Origin Access Control — no API Gateway, per the original roadmap's cost reasoning
- [x] Deliberately skipped OpenNext's "warmer" function — it exists to reduce cold starts under sustained traffic, which directly conflicts with this migration's whole premise of scaling genuinely to zero
- [x] Deployed the real stack to the disposable `pr-1-plexo` compute stack and **found and fixed three real bugs by actually testing**, not assumed-correct:
  1. `FunctionUrlOrigin.withOriginAccessControl` requires `AWS_IAM` auth on the Function URL, not `NONE` — caught at `cdk synth`
  2. The CloudFormation custom resource seeding the tag-cache table failed with `AccessDeniedException` — `AwsCustomResourcePolicy.fromSdkCalls`'s automatic action-inference from `service: "Lambda", action: "invoke"` did **not** produce the real IAM action; fixed with an explicit `lambda:InvokeFunction` policy statement scoped to the one function
  3. The deployed site 403'd with `AccessDeniedException` even with correct-looking OAC config — AWS's own docs confirm OAC-for-Lambda needs **two separate permission grants** (`lambda:InvokeFunctionUrl` *and* `lambda:InvokeFunction`), and CDK's L2 construct only wires the first automatically
- [x] After all three fixes: **hit the live CloudFront URL and got the app's own real 404 page back** — genuine confirmation that Next.js, its middleware, and the OpenNext runtime are executing correctly in Lambda, not just that CloudFormation reported success
- [x] Also upgraded all four Lambda functions off the soon-to-be-deprecated `nodejs20.x` runtime to `nodejs24.x`, caught via a CDK deploy-time warning
- [x] Destroyed the verification deployment cleanly afterward — also a real (successful) test of the teardown path against this larger, more complex stack shape than the earlier placeholder
- [x] Added `.open-next/` to `.gitignore` — build output, not source
- [ ] Wire real app-level env vars (`AUTH_SECRET`, `GOOGLE_CLIENT_ID`/`SECRET`, table names, etc. from SSM) into the server Lambda's `environment` — only OpenNext's own plumbing vars are wired so far; this is what turns "the app runs" into "the app runs *correctly*"
- [ ] Repeat for `plexo-admin` (its own compute stack, same pattern — not yet built)
- [ ] Route 53 + ACM wiring for both apps' real domains — needs the actual production domain names, not yet confirmed
- [ ] Apply Lambda Advanced Logging Controls (WARN/ERROR only) — the CDK-level convention (`buildLogGroup`, 30-day retention) is wired; the log-*level* filter itself isn't yet applied to these specific functions

## Phase 7 — Data migration + parallel-run validation

- [ ] Script the Postgres → DynamoDB backfill (all six tables)
- [ ] Script the better-auth → WorkOS user/org migration
- [ ] Run both systems side by side against production traffic (read-shadow only) for a defined window
- [ ] Diff outputs between old and new systems; close every discrepancy found

## Phase 8 — Cutover

- [ ] Confirm both `plexo-web` and `plexo-admin` are cutting over on the same date (they share every table)
- [ ] Execute the big-bang cutover
- [ ] Decommission Neon/Prisma and the old Vercel deployments once the new stack is confirmed stable
