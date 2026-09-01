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

- [ ] Define ElectroDB entities: BlogSite, SiteLayout, BlogAuthor/Category/Tag/Post(+relations)/Comment/Redirect
- [ ] Define ElectroDB entities: Template, TemplateRevision, TemplateGenerationJob, TemplatePurchase, TemplateAsset, Testimonial
- [ ] Define ElectroDB entities: ImportJob, ImportMediaMap, SiteImportJob/Page/AssetBlob, SiteTransferRequest (TTL-tagged)

## Phase 5 — `plexo-ops` + `plexo-admin` cutover

- [ ] Define ElectroDB entities: PageView, RateLimit, StockCache, AdminAuditLog, FormSubmission (TTL-tagged)
- [ ] Build the monthly DynamoDB → S3 export (native PITR-based export)
- [ ] Wire Athena over the export for ad hoc queries
- [ ] Walk every `plexo-admin` dashboard route (organizations, users, withdrawals, marketplace, script-access-requests, analytics) and confirm each has a real path — a GSI, or the Athena export
- [ ] Deploy `plexo-admin`'s own compute stack alongside `plexo-web`'s

## Phase 6 — Compute & Edge (OpenNext)

- [ ] Build the OpenNext output pipeline for `plexo-web` (SSR Lambda, image-optimization Lambda, ISR revalidation queue, static assets on S3)
- [ ] CDK `EdgeStack`: CloudFront distribution + S3 origin + Lambda Function URLs — no API Gateway (saves $1/M requests for zero functional loss at this scale)
- [ ] Repeat for `plexo-admin`
- [ ] Apply Lambda Advanced Logging Controls (WARN/ERROR only) at deploy time, natively, before first production traffic
- [ ] Route 53 + ACM wiring for both apps' domains

## Phase 7 — Data migration + parallel-run validation

- [ ] Script the Postgres → DynamoDB backfill (all six tables)
- [ ] Script the better-auth → WorkOS user/org migration
- [ ] Run both systems side by side against production traffic (read-shadow only) for a defined window
- [ ] Diff outputs between old and new systems; close every discrepancy found

## Phase 8 — Cutover

- [ ] Confirm both `plexo-web` and `plexo-admin` are cutting over on the same date (they share every table)
- [ ] Execute the big-bang cutover
- [ ] Decommission Neon/Prisma and the old Vercel deployments once the new stack is confirmed stable
