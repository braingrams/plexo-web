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
- **First-party fallback**: Plexo's own simple counts (`PageView`, the "Your visits" cards, MCP `get_analytics`) are independent of Google and always on, so the tab is never empty when Google isn't configured, full, or erroring.
- **MCP/SOL tools**: `get_site_visits`, `turn_on_visitor_numbers`, `turn_off_visitor_numbers`, `share_visitor_numbers_with_google`, `set_cookie_notice` (`lib/mcp/analyticsTools.ts`; tool definitions need mirroring in plexo-mcp). Plain-language errors, paid plan checked.
- Owners who use their own Google account and have never used Google Analytics have no Analytics account; the page links them to analytics.google.com for that step. (The Plexo-managed path avoids this entirely.)

## 5. Cookie notice and Google Consent Mode

- **Who:** visitors whose country is in `lib/consent/regions.ts`: the EU, Iceland, Liechtenstein, Norway, the United Kingdom, Switzerland and Brazil. Add a country there to extend it. The country comes from the edge's request header (`CloudFront-Viewer-Country`, also Vercel's and Cloudflare's); an **unknown** country is treated as "needs asking" (asking someone unnecessarily costs a click; not asking someone who needed it is the mistake that matters). Nobody else sees a banner, and their tag loads straight away.
- **Caching:** published page HTML varies by that header (the published-sites page cache policy already includes `cloudfront-viewer-country` in its cache key: `cdk/lib/published-sites-stack.ts`), so a visitor in Europe never gets a copy cached for the US. Keep that header in the cache key if the policy is ever changed.
- **What happens:** for required visitors the page script (`lib/consent/snippet.ts`) sets Google Consent Mode v2 to **denied** (`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`), does **not** load Google's tag, and shows the notice. **Accept** records `plexo_consent=granted` (first-party cookie, 180 days), updates consent to granted and loads the tag. **No thanks** records `denied`, loads nothing and removes any Google cookies. Returning visitors with `granted` load the tag immediately; with `denied` nothing loads. Advertising consent is never granted.
- **Change cookie settings:** after a choice, a small "Change cookie settings" button stays at the bottom-left. Any element with `data-plexo-cookie-settings` (or a link to `#cookie-settings`) in the owner's own footer also reopens the notice.
- **Design:** inside a shadow root (the site's CSS cannot break it); fixed to the screen (no layout shift); no overlay, no scroll lock, no focus trap (never blocks the page); Accept and No thanks have equal weight; keyboard and screen-reader friendly (`role=region`, visible focus ring, 40px buttons); respects `prefers-reduced-motion` and dark mode; sits above the "Hosted with Plexo" bar. Colours follow the site's Strata brand tokens (`--color-bg-canvas`, `--color-text-primary`, `--color-action-primary`, `--color-focus-ring`) with calm fallbacks.
- **Owner controls** (Visits tab > Cookie notice, MCP `set_cookie_notice`): on/off (on by default), message, button wording, bar or corner card, button colour. Stored in `SiteConsentSettings`.
- **Works with:** builder pages, product pages, uploaded HTML (no `<head>` needed) and React apps. If the owner's own header code already contains the site's measurement ID, Plexo adds nothing (their setup stays in charge). A *different* analytics or ads tag the owner adds themselves is theirs to gate.
- Plexo gives sensible defaults; it is not legal advice. Owners with special needs can switch the notice off.

## 6. Site health

**A key is required.** Google's keyless PageSpeed allowance is zero for shared callers (a real keyless call returned 429 with `quota_limit_value: 0`; the response is saved, redacted, in `tests/fixtures/psi-real-429-keyless.json`). Without `PAGESPEED_API_KEY` the speed half shows plain words ("Plexo has used up its free speed tests for today") and the AI-visibility half still works. `tests/fixtures/psi-mobile-sample.json` is hand-built to Google's documented response shape because no live capture was possible; replace it with a real one once a key exists.

### What a check does
- Runs PageSpeed Insights on the live address twice (phone and computer), plus our own AI-visibility check. Every result is kept for 400 days for the trend.
- Real visitor numbers (Chrome UX data) win over the lab test when Google has them, for this page or, if the page is too new, for the whole site (the screen says which). Google's own fast/average/slow verdict is used for visitor data. When Google has no INP, Total Blocking Time stands in and is labelled as an estimate.
- Savings ("Could save about 1.2 seconds") come only from Google's own estimates. We never invent a number.
- Failures are plain: not live yet, page could not be opened, page looked empty, took too long, daily quota used up, busy right now.
- Re-check: automatic when the owner opens Site health after the site was published or edited (60 second cooldown instead of 5 minutes), and after fixes (the test URL carries a cache-busting query so it measures what visitors now get). It is not a background job: that would need a "needs re-check" marker and a schedule in `cdk/lib/published-sites-stack.ts` (follow-up).
- Cost safety: 1 check per site per 5 minutes (1 minute after a change), 12 per account per hour, and one shared daily budget (`SITE_HEALTH_DAILY_CHECKS`, default 8000 = 16000 Google calls, under the 25000 free daily allowance). A "busy" answer is retried once; a quota answer is not.

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
Added: top picture loads first (fetch priority, no lazy loading, preload), text shows while fonts load plus early connection to Google Fonts, page title from the main heading, share preview tags (Open Graph and Twitter), FAQ markup from real question and answer pairs (needs two), AI crawler welcome lines in robots.txt, trimmed HTML (comments and blank space, never inside scripts, pre, textarea or styles with strings).

### Deliberately not auto-fixed, and why
- **Image compression, resizing, modern formats, lazy loading below the fold:** already done at serve time for pictures in Plexo's uploads (the Next image resizer, `optimizeImages` in the pub route). Linked outside pictures cannot be resized by us: the issue explains how to upload them instead. Width and height attributes need the picture's size, which we do not know at serve time: reported as a manual hint with the element.
- **Defer platform scripts:** the commerce, forms and content scripts are already `defer` (a test guards it). Third-party scripts are not touched: deferring them can break the owner's own code.
- **Cache headers on published pages:** not done on purpose. Page views are counted when the server renders the page, so caching the HTML at the CDN would undercount visits.
- **Heading order, link text, tap size, contrast:** manual only, with the exact element Google pointed at. "Open the editor" opens the site's editor; it does not yet jump to the element (the editor has no deep link).
- **AI alt text and AI page titles:** alt text uses file names (free, no guessing); titles come from the page heading. An AI call per page view is not affordable, and persisting generated text needs a storage design.
- **Product and LocalBusiness markup:** needs real business data (address, hours). Organization markup is the safe default.

### MCP and the assistant
`check_site_health` (includes `assistantNote`: the biggest problem in one sentence and the offer to fix it), `apply_site_health_fix` (preview, apply, undo, or `all`). Web: `lib/mcp/healthTools.ts`; mirrored in plexo-mcp `src/healthTools.ts`.
