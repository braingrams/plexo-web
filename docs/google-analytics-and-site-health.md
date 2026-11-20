# Visitor numbers, cookie notice and Site health: setup

Two features on each site's page in the dashboard: **Visits** (simple counts for everyone, plus detailed visitor numbers on paid plans, plus the cookie notice) and **Site health** (speed check, AI-visibility score, one-click fixes). Both work with sample data when the keys below are missing (outside production), so they can be tried locally.

## 0. What owners get

- **Free plan:** Plexo's own simple visit counts (page views per day). Always on, no setup. The Visits tab shows an upgrade card for detailed numbers.
- **Starter and above (a trial counts):** detailed visitor numbers, in two ways:
  1. **Turn on visitor numbers (default, one click).** Plexo creates and owns a Google Analytics property and web data stream for the site inside Plexo's own Google account, adds the tag, and reads the reports itself. The owner never touches Google. Optionally they can **share it with their own Google account** (access binding, Editor role); Plexo keeps counting.
  2. **Use my own Google account.** The OAuth flow below. The property lives in the owner's account.
- **Cookie notice:** visitors from the EEA, UK, Switzerland and Brazil are asked before Google's tag loads (section 6).

Plan gating is enforced on the server in `app/api/v1/sites/[id]/google-analytics` (every action except turning off), `app/api/google-analytics/start` and `/callback`, the MCP tools, and when pages are served (`tagForSite` checks the owner's plan, so the tag stops within a minute of a plan ending). Helpers: `lib/googleAnalytics/access.ts`.

## 1. Environment variables

| Variable | What it is |
| --- | --- |
| `GOOGLE_ANALYTICS_MANAGED_SERVICE_ACCOUNT` | The Plexo-managed service account's JSON key (plain JSON, or base64 of it). SecureString in SSM (`/plexo/<env>/...`, loaded by `lib/ssmEnv.ts`). |
| `GOOGLE_ANALYTICS_MANAGED_ACCOUNTS` | Comma-separated ids of the Plexo-owned Google Analytics accounts new sites go in, in the order they fill, e.g. `123456789,987654321`. |
| `GOOGLE_ANALYTICS_CLIENT_ID` / `_CLIENT_SECRET` | OAuth client of Plexo's Google Cloud project (type: Web application), for "use my own Google account". |
| `GOOGLE_ANALYTICS_TOKEN_ENCRYPTION_SECRET` | Any long random string. Encrypts owners' refresh tokens and signs the sign-in `state`. Separate from every other secret. Rotating it disconnects every "own account" site; owners press Connect again (managed sites are unaffected). |
| `GOOGLE_ANALYTICS_REDIRECT_URI` | Optional. Defaults to `${NEXT_PUBLIC_APP_URL}/api/google-analytics/callback`. Must match the console exactly. |
| `PAGESPEED_API_KEY` | API key for the PageSpeed Insights API (Site health). |
| `GOOGLE_ANALYTICS_MOCK=1`, `SITE_HEALTH_MOCK=1` | Force sample data. Automatic in dev when the keys are missing; never automatic in production. |
| `SITE_HEALTH_DAILY_CHECKS` / `SITE_HEALTH_SCHEDULED_DAILY` | Daily Google speed-test budgets for owner-run checks (default 3200) and automatic re-checks (default 4800). Together under Google's free 25,000 calls a day. |
| `SITE_HEALTH_RECHECK_PER_RUN`, `SITE_HEALTH_RUN_BUDGET_MS`, `SITE_HEALTH_WEEKLY_QUEUE_PER_SWEEP` | Optional pace of automatic re-checks: checks per run (12), time per run (40000 ms; the server's limit is 60 s), sites queued per weekly sweep (300). |
| `PAGE_PURGE_DAILY`, `PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID` | Edge cache clearing (`lib/pub/edgeCache.ts`): daily ceiling (3000) and the distribution to clear (already in SSM for domains; without it nothing is cleared and copies expire in a minute). |
| `CONSENT_DEV_COUNTRY` | Local testing of the cookie notice (e.g. `DE`). Ignored in production. |

Either path can be configured alone. With neither, the Visits tab shows only the simple counts and says detailed numbers are coming (never an empty or broken tab).

## 2. Google Cloud steps (one time, by Plexo)

### 2a. Shared project

1. Create (or reuse) a Google Cloud project owned by Plexo.
2. **APIs and services > Library**: enable **Google Analytics Admin API**, **Google Analytics Data API** and **PageSpeed Insights API**.
3. **Credentials > Create credentials > API key** for PageSpeed, restricted to the PageSpeed Insights API only. Put it in `PAGESPEED_API_KEY`. (25,000 requests a day free; Plexo limits each site to one check per 5 minutes and each account to 12 an hour.)

### 2b. Plexo-managed analytics (the default path): service account

1. **IAM and admin > Service accounts > Create service account** (name it `plexo-analytics`). No project roles are needed.
2. Open it > **Keys > Add key > Create new key > JSON**. Download it once; store the whole JSON as `GOOGLE_ANALYTICS_MANAGED_SERVICE_ACCOUNT` (SSM SecureString `/plexo/<env>/GOOGLE_ANALYTICS_MANAGED_SERVICE_ACCOUNT`; it is about 2.4 KB, under the 4 KB standard limit). Never commit it or paste it in chat. Rotate by creating a new key, updating SSM, deleting the old key.
3. Sign in to **analytics.google.com with a Plexo-owned Google account** (a shared mailbox such as analytics@yourcompany, not a person's) and **create an Analytics account** for Plexo's sites (any name, e.g. "Plexo sites 1"). Accept the terms. Do NOT create any property in it.
4. In that account: **Admin > Account access management > Add users** > paste the service account's email (`...@...iam.gserviceaccount.com`) > role **Administrator** (needed to create properties and share them). Untick "notify".
5. Copy the account id (Admin > Account settings, "Account ID", digits only) into `GOOGLE_ANALYTICS_MANAGED_ACCOUNTS`.
6. For each further account (see capacity below) repeat steps 3 to 5 and append the id, comma separated.

**Capacity and quotas.** Google allows **2,000 properties per Analytics account** (a Plexo site uses one) and limits how fast properties can be created (Admin API quota; a burst returns 429). Plexo puts a new site in the first listed account with room, moving to the next when Google says an account is full or busy. So the real cap is **2,000 x the number of accounts listed**; add an account well before the current ones fill (the number of managed rows is the count: `SiteGoogleAnalytics` rows with `mode = managed`, grouped by `poolAccountName`). When every account is full the owner is told detailed numbers are busy and keeps the simple counts; nothing breaks. Plexo-managed properties are cleaned up (section 4), which frees room.

**Tenant isolation.** A site is only ever read through the property stored on its own row (`reportForSite`); no request field can name a property, and every managed property id is checked to be a plain `properties/<digits>`. Properties are named after the site's address only. The owner's name or email is never sent to Google (except an email the owner types to receive access).

### 2c. "Use my own Google account": OAuth client

1. **OAuth consent screen**: user type External, app name Plexo, logo, support email, authorised domain `charisol.io`, links to the privacy policy and terms.
2. **Credentials > Create credentials > OAuth client ID > Web application**. Authorised redirect URIs: `https://<app domain>/api/google-analytics/callback` for production, plus staging/local if wanted. Copy the ID and secret into the two `GOOGLE_ANALYTICS_CLIENT_*` variables.

## 3. Scopes and Google's verification (OAuth path only)

Requested scopes:

- `openid`, `email`: to show which Google account is connected.
- `https://www.googleapis.com/auth/analytics.readonly`: read reports (Data API). Sensitive scope.
- `https://www.googleapis.com/auth/analytics.edit`: create the property and data stream for owners who have none (Admin API). Sensitive scope. Kept by decision.

Both analytics scopes are **sensitive**, so before the public can use the button, publish the consent screen (move it out of Testing) and complete Google's **OAuth app verification**: a demo video of the connect flow, a written justification for each scope, a privacy policy that states the Analytics data use (including Google's Limited Use requirements), and domain ownership proof in Search Console. Allow a few weeks. Until verified, up to 100 test users listed on the consent screen can connect, with an "unverified app" warning. **The managed path needs no verification**, which is why it is the default: it uses only Plexo's own account.

The service account additionally uses `analytics.manage.users` (to share a property with an owner's Google account); that is Plexo's own account, so no consent screen is involved. "Share with my Google account" uses the Admin API **v1alpha** access bindings (still alpha at Google; if it changes, only `grantAccess` in `lib/googleAnalytics/managed.ts` needs updating).

## 4. How it works

- **Switch on (managed)**: `POST /api/v1/sites/:id/google-analytics {action:"use_plexo"}` creates the property + web stream in a Plexo account (`lib/googleAnalytics/managed.ts`), stores the row (`mode: managed`, no token), and the tag appears on the site's pages within a minute.
- **Connect (own account)**: `/api/google-analytics/start?siteId=` signs the owner in with Google (authorisation code + PKCE, signed `state`, code verifier in a 10-minute httpOnly cookie). `/api/google-analytics/callback` stores the **encrypted** refresh token, then picks the owner's only property, or shows a list, or creates a property and web data stream for the site's address.
- **Tag**: added as the last step of serving (`applyAnalyticsTag`, after the owner's own header/footer code), for builder pages, product pages, uploaded HTML and React apps alike. A page that already contains the same measurement ID is left alone, and at run time a second `gtag.js` is never added if the page already has one.
- **Reports**: read through an interface (`lib/googleAnalytics/types.ts`) with a sample implementation. A revoked own-account grant shows "sign in again"; a Plexo-managed problem never asks the owner to do anything. Tokens, codes and keys are never logged.
- **Turning off / deleting a site**: a managed property moves to Google's trash (Google keeps it 35 days), unless it was shared with the owner, in which case it stays theirs. An own-account grant is revoked. Deleting a site does this automatically.
- **Plan ends**: the tag stops within a minute; the property and history are kept. The hourly plan sweep marks the row (`lapsedAt`); paying again clears it and everything is back. After **90 days** lapsed, the property goes to Google's trash (`lib/googleAnalytics/lifecycle.ts`).
- **First-party fallback**: Plexo's own simple counts (`PageView`, the "Your visits" cards, MCP `get_analytics`) are independent of Google and always on, so the tab is never empty when Google isn't configured, full, or erroring. They are recorded by the page's own counting script (see "Counting visits when pages are cached" below), not when the server renders the page, so edge caching never undercounts them. The Google tag is untouched and Google's numbers stay Google's: a visit is counted once in each system, never twice in either.
- **MCP/SOL tools**: `get_site_visits`, `turn_on_visitor_numbers`, `turn_off_visitor_numbers`, `share_visitor_numbers_with_google`, `set_cookie_notice` (`lib/mcp/analyticsTools.ts`; tool definitions need mirroring in plexo-mcp). Plain-language errors, paid plan checked.
- Owners who use their own Google account and have never used Google Analytics have no Analytics account; the page links them to analytics.google.com for that step. (The Plexo-managed path avoids this entirely.)

## 5. Cookie notice and Google Consent Mode

- **Who:** visitors whose country is in `lib/consent/regions.ts`: the EU, Iceland, Liechtenstein, Norway, the United Kingdom, Switzerland and Brazil. Add a country there to extend it. The country comes from the edge's request header (`CloudFront-Viewer-Country`, also Vercel's and Cloudflare's); an **unknown** country is treated as "needs asking" (asking someone unnecessarily costs a click; not asking someone who needed it is the mistake that matters). Nobody else sees a banner, and their tag loads straight away.
- **Caching:** published page HTML varies by that header (the published-sites page cache policy includes `cloudfront-viewer-country` in its cache key: `cdk/lib/published-sites-stack.ts`), so a visitor in Europe never gets a copy cached for the US. Keep that header in the cache key if the policy is ever changed. Region and city are no longer in the key (they split every page into a copy per city); the visit beacon gets them instead.
- **What happens:** for required visitors the page script (`lib/consent/snippet.ts`) sets Google Consent Mode v2 to **denied** (`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`), does **not** load Google's tag, and shows the notice. **Accept** records `plexo_consent=granted` (first-party cookie, 180 days), updates consent to granted and loads the tag. **No thanks** records `denied`, loads nothing and removes any Google cookies. Returning visitors with `granted` load the tag immediately; with `denied` nothing loads. Advertising consent is never granted.
- **Change cookie settings:** after a choice, a small "Change cookie settings" button stays at the bottom-left. Any element with `data-plexo-cookie-settings` (or a link to `#cookie-settings`) in the owner's own footer also reopens the notice.
- **Design:** inside a shadow root (the site's CSS cannot break it); fixed to the screen (no layout shift); no overlay, no scroll lock, no focus trap (never blocks the page); Accept and No thanks have equal weight; keyboard and screen-reader friendly (`role=region`, visible focus ring, 40px buttons); respects `prefers-reduced-motion` and dark mode; sits above the "Hosted with Plexo" bar. Colours follow the site's Strata brand tokens (`--color-bg-canvas`, `--color-text-primary`, `--color-action-primary`, `--color-focus-ring`) with calm fallbacks.
- **Owner controls** (Visits tab > Cookie notice, MCP `set_cookie_notice`): on/off (on by default), message, button wording, bar or corner card, button colour. Stored in `SiteConsentSettings`.
- **Works with:** builder pages, product pages, uploaded HTML (no `<head>` needed) and React apps. If the owner's own header code already contains the site's measurement ID, Plexo adds nothing (their setup stays in charge). A *different* analytics or ads tag the owner adds themselves is theirs to gate.
- Plexo gives sensible defaults; it is not legal advice. Owners with special needs can switch the notice off.

## 5b. Counting visits when pages are cached

Published pages are sent with `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300` (`PAGE_CACHE_CONTROL`, `lib/pub/visitBeacon.ts`): the edge keeps a copy for a minute and serves it while refreshing for five more; browsers always ask again. The page cache policy (`cdk/lib/published-sites-stack.ts`) allows up to an hour, so the origin's header decides.

- **Clearing on change:** `lib/pub/edgeCache.ts` clears the site's saved copies when a page is saved or published (`onTemplateSaved` -> `afterSiteChanged`) and when a Site health fix is switched on or off. A custom domain is its own CloudFront tenant, so one `/*` clear for the tenant (`CreateInvalidationForDistributionTenant`); a plexopages address clears the exact paths of its pages on the distribution (one `/*` if there are more than 30). Best effort: with no `PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID`, a limit, or an AWS error, nothing breaks and the copies expire within a minute. Limits: a site once per 10 seconds, everyone `PAGE_PURGE_DAILY` (default 3000) a day. CloudFront gives 1,000 cleared paths a month free, then charges per path, so that daily ceiling is the cost ceiling. The server role has `cloudfront:CreateInvalidation*` (`cdk/lib/compute-stack.ts`).
- **Counting:** every page carries a tiny first-party script (`injectVisitBeacon`) that sends one `POST /__plexo/v` to the site's own address. That behaviour is never cached (`cdk`: `__plexo/v`, `CACHING_DISABLED`, `visitBeaconOriginPolicy` passing the host, browser and viewer location). The route (`app/api/public/visit/[domain]`, `lib/pub/recordVisit.ts`) believes the page id only if it belongs to the site on that address, ignores bots and no-JavaScript visits, and allows 20 per visitor per page per minute. The server no longer records a `PageView` when it renders, so there is exactly one counter and nothing counts twice.
- **Consent:** no cookies, no browser storage. Visitors in places that need consent (`lib/consent/regions.ts`, unknown counts as needing it) and browsers sending Global Privacy Control or Do Not Track are still counted in the totals, but with no address hash, browser string, region or city (`mayRecognise`).
- **Known limits:** a visitor with JavaScript off, or a blocker that stops first-party scripts, is not counted (a trade for no longer counting crawlers). Product detail pages, uploaded files and React apps keep their previous behaviour (product pages and files were never counted; apps count through their own runtime route) and are not edge cached by this change.
- **What is tested here and what needs AWS:** the exact clearing requests (distribution id, paths, tenant, caller reference, limits) and who may start each scheduled route are unit-tested (`tests/siteHealthOps.test.ts`); the CloudFront behaviour and origin request policy are covered by tests of the template strings. What only AWS can show is verified with the commands in section 7. Quick check on staging: `curl -I` a page twice (`X-Cache: Hit from cloudfront`), publish, confirm the next request is a miss, and check the visit count moves by one per browser load.

## 6. Site health

**A key is required.** Google's keyless PageSpeed allowance is zero for shared callers (a real keyless call returned 429 with `quota_limit_value: 0`; the response is saved, redacted, in `tests/fixtures/psi-real-429-keyless.json`). Without `PAGESPEED_API_KEY` the speed half shows plain words ("Plexo has used up its free speed tests for today") and the AI-visibility half still works. `tests/fixtures/psi-mobile-sample.json` is hand-built to Google's documented response shape because no live capture was possible; replace it with a real one once a key exists.

### What a check does
- Runs PageSpeed Insights on the live address twice (phone and computer), plus our own AI-visibility check. Every result is kept for 400 days for the trend.
- Real visitor numbers (Chrome UX data) win over the lab test when Google has them, for this page or, if the page is too new, for the whole site (the screen says which). Google's own fast/average/slow verdict is used for visitor data. When Google has no INP, Total Blocking Time stands in and is labelled as an estimate.
- Savings ("Could save about 1.2 seconds") come only from Google's own estimates. We never invent a number.
- Failures are plain: not live yet, page could not be opened, page looked empty, took too long, daily quota used up, busy right now.
- Re-check, by the owner: when the owner opens Site health after the site was published or edited (60 second cooldown instead of 5 minutes), and after fixes (the test URL carries a cache-busting query so it measures what visitors now get).
- Re-check, in the background (`lib/siteHealth/recheck.ts`): a change (page saved or published, a fix on or off) queues a check for 15 minutes after the LAST change (each new change moves it back, so a burst of edits is one check), only for sites whose owner has used Site health. A weekly sweep (`/api/internal/site-health/sweep`, hourly, queues up to 300 live sites last checked over a week ago or never) feeds the same queue. `/api/internal/site-health/recheck` (every 10 minutes, `cdk/lib/published-sites-stack.ts`, `x-cron-secret` auth like the other internal routes) runs what is due inside about 40 seconds, so a run does about 6 to 12 checks and the queue drains at roughly 1,000 a day; raise the schedule rate or `SITE_HEALTH_RECHECK_PER_RUN` to go faster. Both routes lock themselves because EventBridge retries a call slower than its 5 second timeout. A site that cannot be checked yet (a limit) stays queued, retried an hour later, four tries at most. Checks made this way are marked (`report.auto`), and Site health says "Checked for you", when the next automatic one is due, and shows them in the same trend. No email digest: the only simple existing paths are admin notifications and transactional mail, and nothing owner-facing and optional exists to hang it on, so it is not added.
- Cost safety: 1 check per site per 5 minutes (1 minute after a change), 12 per account per hour for checks the owner runs, and two shared daily budgets: owner-run `SITE_HEALTH_DAILY_CHECKS` (default 3200) and automatic `SITE_HEALTH_SCHEDULED_DAILY` (default 4800), together 8000 checks = 16000 Google calls, under the 25000 free daily allowance. Automatic checks also stop at 40 a day per account and never use the owner-run allowances. A "busy" answer is retried once; a quota answer is not.

### AI-visibility score (ours, honest)
Computed from the live page, robots.txt, llms.txt and sitemap. Weights total 100 and live in `AEO_WEIGHTS` (`lib/siteHealth/aeo.ts`).

| Check | Weight | Why it counts |
|---|---|---|
| Business markup beyond the basic site label (Organization, LocalBusiness...) | 18 | The clearest machine-readable signal of who you are |
| One main heading plus section headings | 14 | How AI tools split a page into quotable answers |
| Search summary 50 to 200 characters | 11 | The text shown in results and often quoted |
| AI crawlers not blocked in robots.txt | 10 | Blocked means invisible |
| llms.txt published | 8 | New and optional, so it counts less than the hype suggests |
| Sitemap | 7 | Helps find every page |
| Pictures have descriptions | 7 | Pictures are unreadable to machines without them |
| Page title | 7 | The name in every result |
| Questions marked up (only if the page has questions) | 5 | Lets answers be quoted |
| Share preview tags (title plus picture or summary) | 5 | How links look when shared |
| Canonical link | 4 | Avoids split rankings |
| Page language | 4 | Translation and screen readers |

A page with nothing to mark up for a check (no pictures, no questions) passes it. Speed, Search, Easy to use and Safe and tidy are Google's own Lighthouse scores, unmodified.

### "Fix it for me": reversible, serve-time
Stored per site in `SiteHealthSettings` and applied while pages are served (`lib/siteHealth/serve.ts`, `speedFixes.ts`). Nothing in the owner's pages is rewritten; turning a fix off restores the page byte for byte. Every fix only adds what is missing, is idempotent, and has a preview (what changes, plus a projected AI-visibility score) before it is applied. The search summary preview is editable and the approved text is what gets saved. "Fix everything" applies every applicable fix and returns a summary; "Undo everything" clears them.

Original six: search summary (AI-written), llms.txt, business details markup, lazy videos and maps, picture descriptions from file names (including pictures served through the resizer, never a generic name like "image"), page language.
Gap-closing additions: pictures reserve their space (`image_sizes`), business and product markup built from the owner's real details (`organization_schema` extended, `product_schema`), and page titles and picture descriptions written once with AI and stored (`page_title`, `alt_text` extended). Details below.
Added: top picture loads first (fetch priority, no lazy loading, preload), text shows while fonts load plus early connection to Google Fonts, page title from the main heading, share preview tags (Open Graph and Twitter), FAQ markup from real question and answer pairs (needs two), AI crawler welcome lines in robots.txt, trimmed HTML (comments and blank space, never inside scripts, pre, textarea or styles with strings).

### Picture sizes (`image_sizes`, "Stop the jumping")
- **Where sizes come from** (`lib/siteHealth/imageSize.ts`): pictures uploaded to Plexo are measured from the file itself at upload (`/api/v1/media/upload`, blog image upload) and stored in `ImageDimension`. Anything else (pictures linked from other sites, older uploads) is looked up once when the owner switches the fix on, and again for new pictures after changes: the first 256 KB only, through `safeFetch` (the site-import SSRF guard: public addresses only, redirects re-checked), 5 second timeout, at most 60 lookups per run, 4 at a time. Answers are kept 180 days; an unreadable picture is remembered for a week, so a dead link is not retried on every check. Serving a page never fetches anything. Known gap in the guard (from `fetchSafe`): DNS rebinding between check and connect is not pinned.
- **What is served:** `width`, `height` and `aspect-ratio` on `<img>` tags that have neither, plus one zero-weight rule (`:where(img[data-plexo-sized]){height:auto}`) so a picture made narrower on a phone is not stretched and the owner's own CSS always wins. A picture with its own width/height, or whose size is unknown, is untouched. Reversible like every fix.
- Reads PNG, JPEG (EXIF rotation swapped), GIF, WebP, AVIF and SVG headers; a picture over 20,000 pixels either way is treated as unreadable.

### Business and product markup
- **Organization / LocalBusiness** (`lib/siteHealth/businessMarkup.ts`, `business.ts`): built only from things the owner already gave Plexo or confirms in the preview: the site name, the logo (brand), phone, email and social profile links already on the page (share buttons are ignored), the pickup address in shop settings, and booking times (as opening hours). Stored with the health settings and used as stored. It becomes a LocalBusiness only with a street and a town; otherwise it is an honest Organization. The preview shows a friendly form pre-filled with what was found ("We already found your logo, your pickup address...") and asks only for what a place-based business still lacks (address, phone). Applying in one step (MCP, Fix everything) uses what is known and never blocks on the form. Confirmed details are kept when the fix is switched off, but not served.
- **Product** (`product_schema`, "Show my prices in Google"): offered only to sites with active physical products; adds Product + Offer markup (price from the product record, currency, in stock or out of stock from stock quantity, picture, description, sku) to product detail pages as they are served. No owner questions: it is all in the product record. It does not change the AI-visibility score (the score has no product check), and the screen says so.

### Page titles and picture descriptions (written once)
- `page_title` and `alt_text` generate text **once**, when the fix is previewed (`lib/siteHealth/aiText.ts`), never per visit. Titles come from one call for all pages that have none (at most 15 per run); picture descriptions are written by looking at each picture (vision, JPEG/PNG/GIF/WebP up to 3 MB, at most 12 per run; ones that cannot be opened are skipped, not guessed). Both use Plexo's own small model (`bedrock_claude` BASIC) and are billed to the owner's AI credits at the real usage; the credits are checked first and nothing is written (or charged) when they are short, with a plain message. The preview shows the texts in editable boxes, says how many credits it used, and has "Write them again" (the only thing that writes again; opening the preview a second time reuses what is stored, at no cost).
- Stored in `SiteHealthSettings` (`aiTitles` by page path, `aiAlts` by picture address) and served as stored, owner edits included. They are kept when the fix is switched off but not served, so Undo restores the page byte for byte. Without an account to bill (no user), or when AI is unavailable, the previous behaviour (title from the main heading, description from the file name) still applies.
- Scheduled re-checks never write AI text.

### Open the editor at the exact element
`lib/siteHealth/editorLinks.ts` finds, in what the owner edits, the element Google (or our own scan) pointed at, by its picture address, link or words, and returns address parameters: `focus=<element id>` (visual editor: scrolls to it, highlights it for a few seconds with a short note, `app/dashboard/templates/[id]/focusElement.ts`), `mode=text&field=img-0` (Text view opens that field and highlights it on the page), `mode=code&line=N` (Code view puts the cursor on the line). Each problem's "Take me to it" button and its "Show me in the editor" / "Show me in the code" links use them. When nothing matches there is no parameter and the editor opens normally. The classic (older) block editor does the same through the SDK's `focusNodeId` prop (SDK 2.0.34 and later): it selects the element and scrolls to it. Design view on HTML pages is not targeted separately (Text view is the friendly equivalent).

### Still deliberately not auto-fixed
- **Image compression, resizing, modern formats, lazy loading below the fold:** already done at serve time for pictures in Plexo's uploads (the Next image resizer, `optimizeImages` in the pub route). Linked outside pictures cannot be resized by us: the issue explains how to upload them instead.
- **Defer platform scripts:** the commerce, forms and content scripts are already `defer` (a test guards it). Third-party scripts are not touched: deferring them can break the owner's own code.
- **Heading order, link text, tap size, contrast:** manual only, with the exact element Google pointed at and a link that opens the editor on it.

### The weekly email ("Your site health")
- **What it is** (`lib/siteHealth/digest.ts`, `buildSiteHealthDigestEmail` in `lib/mail/templates.ts`, sent through Maildrip like every other Plexo email): once a week to the site's owner. Plain words: how the site is doing, each score with how it moved since the last email, the 3 things worth fixing first (with "Plexo can fix this for you in one click" where it can), and one button that opens the Site health tab. It reports a check that already exists; sending it never runs a speed test.
- **Owner control:** on by default. A "Weekly email" switch at the top of the Site health tab (`POST /api/v1/sites/{id}/health/digest`), the same through the assistant (`set_site_health_email`), and an unsubscribe link in every email that works in one tap without signing in (signed with a key derived from `AUTH_SECRET`, `GET /api/public/site-health/unsubscribe`). Stored as `digestOff` on `SiteHealthSettings`; the email's own bookkeeping (`digestSentAt`, `digestScores`) does not count as a fix change.
- **Schedule:** `SiteHealthDigest` runs daily at 08:00 UTC (`/api/internal/site-health/digest`, cron secret or admin token, locked). A site is emailed at most once every 6 days and only if its last check is under 9 days old, so the daily run only reaches sites that are due and a backlog spreads over days.

### MCP and the assistant
`check_site_health` (includes `assistantNote`: the biggest problem in one sentence and the offer to fix it), `apply_site_health_fix` (preview, apply, undo, or `all`; new inputs `business`, `titles`, `alts`, `regenerate`, and fixes `image_sizes`, `product_schema`). Web: `lib/mcp/healthTools.ts`; mirrored in plexo-mcp `src/healthTools.ts` (parity is checked by `src/toolDefs.test.ts` in plexo-mcp). `set_site_health_email` turns the weekly email on or off..

## 7. To enable in production

Everything below needs AWS or Google access, so it cannot be done from a development machine. Run these once per environment. `staging` below is the environment's SSM name (`/plexo/<env>/...`) and `$STACK_ID` is the stack prefix the deploy uses (`<STACK_ID>-published-sites-stack`, `<STACK_ID>-compute-stack`); use the values of the environment you are enabling. Nothing is lost by skipping a step: the feature just waits (pages simply expire from the edge within a minute, checks show plain words about the missing key).

**1. Deploy the schedules** (the stack adds the Site health jobs, including the weekly email at 08:00 UTC):
```
cd cdk && STACK_ID=$STACK_ID npx cdk deploy $STACK_ID-published-sites-stack --require-approval never
```
Check the rules exist: `aws events list-rules --name-prefix $STACK_ID-published-sites-stack --query "Rules[?contains(Name,'SiteHealth')].[Name,ScheduleExpression,State]" --output table` (expect Recheck every 10 minutes, Sweep hourly, Digest daily).

**2. Tell the app which distribution to clear** (`PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID`). Read it from the stack output and store it in SSM:
```
DIST=$(aws cloudformation describe-stacks --stack-name $STACK_ID-published-sites-stack --query "Stacks[0].Outputs[?OutputKey=='PrimaryDistributionId'].OutputValue" --output text)
aws ssm put-parameter --name /plexo/staging/PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID --type SecureString --value "$DIST" --overwrite
```
The connection group and routing endpoint use the same pattern (`PLEXO_PUBLISHED_SITES_CONNECTION_GROUP_ID` from the `ConnectionGroupId` output, `PLEXO_PUBLISHED_SITES_ROUTING_ENDPOINT` from `ConnectionGroupRoutingEndpoint`). Then redeploy the server so it reads them: `cd cdk && STACK_ID=$STACK_ID npx cdk deploy $STACK_ID-compute-stack`. The server role already allows `cloudfront:CreateInvalidation*`.

**3. Cost ceilings:** nothing to do: the defaults (3000 edge clears a day, 3200 owner-run and 4800 automatic checks a day) apply. To change one, set it as a Lambda environment variable in `cdk/lib/compute-stack.ts` (`PAGE_PURGE_DAILY`, `SITE_HEALTH_DAILY_CHECKS`, `SITE_HEALTH_SCHEDULED_DAILY`).

**4. Google speed tests:** create an API key restricted to the PageSpeed Insights API in the shared Google Cloud project and store it: `aws ssm put-parameter --name /plexo/staging/PAGESPEED_API_KEY --type SecureString --value "<key>" --overwrite`. Without it owners see "used up its free speed tests".

**5. Prove the edge caching works** (a real site's address):
```
curl -sI https://<site>.plexopages.io/ | grep -i x-cache      # Miss from cloudfront
curl -sI https://<site>.plexopages.io/ | grep -i x-cache      # Hit from cloudfront
# publish or edit the page in Plexo, then:
curl -sI https://<site>.plexopages.io/ | grep -i x-cache      # Miss again: the clear worked
aws cloudfront list-invalidations --distribution-id "$DIST" --max-items 3
```

**6. Prove the scheduled jobs and the email** (the cron secret is in SSM at `/plexo/staging/CRON_SECRET`):
```
SECRET=$(aws ssm get-parameter --name /plexo/staging/CRON_SECRET --with-decryption --query Parameter.Value --output text)
curl -s -H "x-cron-secret: $SECRET" https://<app-domain>/api/internal/site-health/sweep
curl -s -H "x-cron-secret: $SECRET" https://<app-domain>/api/internal/site-health/recheck
curl -s -H "x-cron-secret: $SECRET" https://<app-domain>/api/internal/site-health/digest   # {"sent":N,...}; a second call within a day answers "skipped"
```
Without the header each answers 401. To see the email without waiting, run the digest as above on a site whose owner is you; it only sends to a site that has a check from the last 9 days.

## 8. Screenshots

Made from the dev preview routes with fixture data (`npm run dev`, then `/v3-preview/health?scenario=slow|fast`, `/v3-preview/visits?state=on|off`, `/v3-preview/cookie-notice/sample?position=bar|card`): `docs/screenshots/health/*.png` (slow and fast site, phone and computer tabs, fix preview, undo, weekly email switch, a phone-sized screen) and `docs/screenshots/analytics/*.png` (turn on visitor numbers, Plexo-managed numbers, cookie notice settings, the real notice on a sample page).
