# Plan gates audit

Every limit that Free / Starter / Pro / Enterprise puts on something, where the server enforces it, what the
API answers, and what the owner sees. The entitlement table is `lib/subscription.ts` (`getTierFeatures`); a gate
is any place that reads it (or `lib/plan/*`) and refuses.

How a gate looks on the wire: `planGateBody` / `planGateResponse` / `limitGateResponse` (403) with a stable `PLAN_*`
`code`, plain-words `error`, `requiredPlan` (computed by `lib/plan/planNeeded.ts`, so it never points at a plan that
would not help) and `upgradeUrl`. MCP/SOL tools return the same sentence plus the plan and an upgrade link
(`planGateMessage`). In the dashboard every failed action is picked up by `PlanGateWatcher` (a fetch watcher mounted in
`app/dashboard/layout.tsx`): screens show `UpgradePrompt`/`GateOrError` inline, and if a screen shows nothing the watcher
opens the same prompt in a dialog. `UpgradePrompt` starts the free 14-day trial while it is unused, otherwise goes to
checkout, and both return to the same page. Locked controls use `PlanLock` (lock + plan badge, press = prompt).

Status: DONE = server returns a code + requiredPlan AND the UI shows the prompt (inline or locked control).

| # | Gate (feature field) | Plan | Server (route / lib) | Code | UI surface | Status |
|---|---|---|---|---|---|---|
| 1 | Sites / landing pages count (`maxLandingPages`) | Free 5, Starter 25, Pro 100 | `api/templates`, `templates/[id]/duplicate-site`, `convert-type`, `v1/publish`, `v1/templates/upload-raw`, `lib/marketplaceUse`, `lib/projects/createProject`, MCP `dispatchMcpTool`, `v2Pages` | PLAN_TEMPLATE_LIMIT / PLAN_PROJECT_LIMIT | new-site flow, marketplace use, editor, watcher | DONE |
| 2 | Email templates count (`maxEmailTemplates`) | Free 1, Starter 5, Pro 20 | same routes as 1 | PLAN_TEMPLATE_LIMIT | emails library, new email dialog (GateOrError) | DONE |
| 3 | Live sites at once (`maxPublishedSites`) | Free/Starter 1, Pro 4 | `lib/plan/publishGuard`, `v1/publish`, `v1/domains`, strata publish | PLAN_SITE_LIMIT_EXCEEDED | editor publish dialog, hub address tab | DONE (earlier) |
| 4 | Pages live per site (`maxPublishedPagesPerSite`) | Free: home only | `publishGuard.assertCanPublishPage`, `templates/[id]/publish`, MCP publish | PLAN_PAGE_LIMIT_EXCEEDED | Pages panel (now an UpgradePrompt), editor | DONE |
| 5 | Custom domain (`customDomainEnabled`, trial waits for payment) | Starter+ | `domainGate`, `v1/domains`, `v1/domains/purchase`, `v1/publish`, `linkDomain` | PLAN_CUSTOM_DOMAIN_REQUIRES_UPGRADE | domains screens, wizard, settings/domains (prompt) | DONE |
| 6 | Custom domain count (`maxCustomDomains`, `getDomainLimit`) | Starter 1, Pro 3 | `v1/publish`, `linkDomain`, `domains/purchase` | PLAN_CUSTOM_DOMAIN_LIMIT | same | DONE |
| 7 | Custom code (`customCodeEnabled`) | Starter+ | `site-layout/[id]/custom-code` PUT | PLAN_CUSTOM_CODE | site layout code card | DONE |
| 8 | Remove Plexo badge (`brandingRemovalEnabled`) | Starter+ | `api/profile` | PLAN_BRANDING | profile screen | DONE (earlier) |
| 9 | White label (`whiteLabelEnabled`) | Enterprise | `organizations/[id]/branding` | PLAN_BRANDING | branding settings (prompt, was a plain note) | DONE |
| 10 | Commerce on (`commerceEnabled`) | Starter+ | `commerce/[id]/settings`, MCP `update_commerce_settings` | PLAN_COMMERCE_LIMIT | hub Add-more, commerce settings (all tabs via action bar), watcher | DONE |
| 11 | Own Paystack/Stripe keys (`ownPaymentKeysEnabled`) | Pro+ | same | PLAN_OWN_PAYMENT_KEYS | payments settings: both "Use your own keys" cards are locked (PlanLock, Pro) | DONE |
| 12 | Products count (`maxCommerceProducts`) | Starter 1,000, Pro 5,000 | products, import, import-ai, MCP create product | PLAN_PRODUCT_LIMIT | products, CSV/AI import, sell modal, hub products | DONE |
| 13 | Discounts, delivery methods, bank transfers, digital downloads, bookings, donations | no limit in the entitlement table; only need Commerce on (row 10) | their routes need an enabled store; errors flow to row 10 | PLAN_COMMERCE_LIMIT | discounts/delivery/donations/availability/orders screens now render errors with GateOrError | DONE |
| 14 | Funnels / courses slots (`includedFunnelSlots`, add-on slots) | Free 0, Starter 1, Pro 3 | `v1/lms/funnels` POST (+ GET `slotsGate`), MCP `create_funnel` | PLAN_FUNNEL_SLOTS (`canBuySlot`) | new funnel launcher, new course dialog (prompt up front, "Buy one extra slot"), hub Add-more, course settings | DONE |
| 15 | Funnel pages, lessons, students, drip, certificates, enrollments | no limit in the entitlement table | n/a | n/a | course/funnel settings render any limit error with the prompt anyway | DONE (nothing to gate) |
| 16 | Blog published posts (`maxPublishedBlogPosts`, `blogEnabled`) | Free 0 live | `blog/[id]/posts` (POST, PATCH), MCP blogTools | PLAN_BLOG_LIMIT (was QUOTA_EXCEEDED) | blog list/editor upgrade modal (trial), error spots | DONE |
| 17 | Blog authors, forms submissions/destinations, email broadcasts, storage/media | no limit exists in the entitlement table | n/a | n/a | n/a | DONE (nothing to gate) |
| 18 | Team seats (`teamSeats`) | Free 0, Starter 2, Pro 5 | `org/invite`, `server/orgDynamo.SeatLimitError` | PLAN_SEAT_LIMIT_EXCEEDED (requiredPlan now the plan with more seats) | team settings (prompt), invite form | DONE |
| 19 | API keys (`maxApiKeys`) | Free 1, Starter 3, Pro 10 | `settings/api-keys` POST (server check added: it was only a disabled button) | PLAN_API_KEYS | developers: "New API key" opens the prompt, no dead button | DONE |
| 20 | Compile API (`compileApiEnabled`) | paid | UI-only lock | n/a | developers: MJML panel is a `PlanLock` | DONE |
| 21 | Publish from apps (`manageLandingPagePublishingEnabled`) | Pro+ | `api/profile` | PLAN_AI_ACCESS | developers + SDK page (`PlanLock` / prompt) | DONE |
| 22 | Host-managed AI (`hostManagedAiEnabled`) | Pro+ | `settings/api-keys/[id]`, `ai/generate` | PLAN_HOST_MANAGED_AI | AI settings: option opens the prompt, no disabled button | DONE |
| 23 | Server apps / SSR (`ssrEnabled`) | Pro+ | `ssr-*` routes, `ssrGuard`, `ssrPush` | PLAN_SERVER_APPS | new-site wizard "Server app Pro" tab (prompt), detail tabs | DONE |
| 24 | Hosting tier (`deployedAppHostingTiers`) | Pro | `v1/templates/[id]/deploy`, `deploy/chunk`, `lib/pub/hostingTier` | PLAN_HOSTING_TIER (deploy route was bare) | deploy panel | DONE |
| 25 | Analytics (`analyticsEnabled`) | Starter+ | `v1/analytics`, `analytics/visits`, google-analytics | PLAN_ANALYTICS | insights, visits | DONE |
| 26 | Site import / WordPress migration (`siteMigrationEnabled`) | Starter+ | `site-import/detect`, `wpMigration/access`, MCP wp tools | PLAN_SITE_IMPORT / PLAN_MIGRATION (requiredPlan now computed) | moving settings (prompt), migrate screens, pages overview "Add new" (`PlanLock`) | DONE |
| 27 | Multi-page site import (`multiPageSitesEnabled`) | Starter+ | `siteImport/adminAuth` | PLAN_SITE_IMPORT | pages overview | DONE |
| 28 | MCP / API access (`mcpEnabled`, `sdkEnabled`) | all paid tiers have it; no server refusal exists | n/a | n/a | n/a | DONE (nothing to gate) |
| 29 | AI credits (monthly allowance, `lib/credits/value.ts`) | Free 200, Starter 1,000, Pro 2,000, Ent 3,000 | `solChatHandler`, `ai/generate`, `ai/stream/assist`, `blog ai-generate-image`, WhatsApp | OUT_OF_CREDITS + `topUpUrl`/`ownKeyUrl`/`upgradeUrl` | SOL chat modals (both dashboards), write drawer, multi-page dialog, new-site wizard, editors, raw AI panel, blog drawer and featured image: all offer Top up, Use my own AI key, Upgrade for more credits (amounts from value.ts, no trial because a trial adds no credits). `?topup=` deep link opens checkout and returns | DONE |
| 30 | Visitor-facing checkout refusals (`checkoutPlanBlock`, `livePaymentError`) | n/a | public checkout | none (visitor sees a calm message, not an upgrade) | by design | n/a |
| 31 | Site transfer warnings | warnings, not refusals | `siteTransferDynamo` | none | by design | n/a |

Tests: `tests/planGateCodes.test.ts` (every code round-trips, which plan lifts each limit, credits offer),
`tests/planGateCoverage.test.ts` (scan: no API route answers 402/403 with plan wording and no code; no bare limit
sentences left in app/ or lib/; error spots on commerce/funnel/course/hub screens go through the prompt).
Screenshots: `docs/screenshots/upgrade/*.png` (preview route `app/v3-preview/upgrade`).
