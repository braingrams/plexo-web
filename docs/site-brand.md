# Site brand from Strata (live)

> How the brand is resolved and used everywhere (precedence rule, SOL, MCP, the picker): see [STRATA_BRAND.md](./STRATA_BRAND.md).

A site links to ONE Strata project (site settings → **Brand**). Plexo writes the brand as a hosted stylesheet and every page of
the site links to it, so when someone **publishes** in Strata the live site changes within a minute or two, with no rebuild.
Autosaves in Strata never reach a live site.

## How it flows

1. **Link** (`POST /api/v1/sites/:id/brand`): with the owner's Strata session Plexo creates a read-only integration key
   (`design-system:read`, this project only, stored encrypted), pulls `GET /projects/:id/design-system?source=published`, saves it
   (`private/site-brand/<siteId>/design-system.json.gz`, or the app's own `src/plexo-canvas/design-system.json`), writes the sheet
   (`public/__plexo/brand/<siteId>.css`) and subscribes to the project's `design-system.published` webhook (one subscription per
   project, shared by every linked site). Built pages are rebuilt once so they defer to the sheet.
2. **Publish in Strata** → `POST /api/v1/strata/webhook` (HMAC-SHA256 signed, 5-minute replay window) → every linked site with
   "Keep in sync" on is updated in the background: pull → `planAutoUpdate` → save → regenerate the sheet. Token changes stop there.
   Component changes also rebuild visual-editor pages (and rebuild/republish apps), because component styles are written into pages.
3. **Fallback**: the 15-minute job (`/api/internal/strata-auto-update`) checks every linked site's published revision and
   re-subscribes any project whose webhook is missing.

## What each kind of site gets

| Site | Brand on the live site |
| --- | --- |
| Visual editor (V2) pages | `<link>` to the sheet, `?v=<revision>`. Compiled token values sit on `:where(:root)` (zero specificity), so the sheet wins. |
| Raw HTML upload, WordPress migration | When "Use my brand on this site" is on: the site's own main colours/fonts (matched on import or "Apply my brand") are served as `var(--token, <original>)` in its pages and CSS files, plus the link. Off = the original files, byte for byte. |
| React app | `<link>` in the served `index.html`. Canvas pages use the variables; hand-written code can too. |
| Deployed static site | `<link>` added to HTML files only, at a stable address (no `?v=`) because that HTML is cached for an hour; the sheet's own 5-minute cache carries the change. |
| Deployed server app (SSR) | Opt-in. With "Add my brand to my app" on (Brand tab; on automatically for server apps linked after this shipped, off for every app linked before), Plexo adds the `<link>` to the full HTML pages it serves, at a stable address. Never to JSON, fragments, redirects, pages over 2 MB, pages that already link the sheet, pages with `<meta name="plexo-brand" content="off">` or their own meta CSP; any failure serves the app's page untouched. Global kill switch: `BRAND_SERVER_INJECT=off`. Or add the link to your layout yourself: `<link rel="stylesheet" href="/__plexo/brand/<siteId>.css">` |
| Classic editor pages | Unchanged (they don't use brand variables). |

### Server apps: how the link gets in

The serve layer (`lib/pub/serveDeployedSsr.ts`) already reads an app's whole response before relaying it (length and encoding headers are dropped
and rebuilt), so `lib/brand/ssrInject.ts` adds one string insert to full HTML pages: no streaming transform is needed. The flag is
`SiteBrand.injectServerApp` (absent = off). It is separate from "Use my brand on this site" on purpose: existing linked apps already
have that on and must not change. Only the owner's switch, or linking a server app from now on, sets it.

## Using the brand in your own code

The sheet is served on the site's own domain at `/__plexo/brand/<siteId>.css` (`max-age=60, s-maxage=300, stale-while-revalidate`).

- Every Strata token is a CSS variable with Strata's own name: `var(--color-brand-primary-500)`, `var(--color-text-primary)`,
  `var(--color-bg-canvas)`, `var(--color-action-primary-bg)`, `var(--font-family-heading)`, `var(--font-family-body)`,
  `var(--font-size-lg)`, `var(--space-4)`, `var(--radius-md)` …
- Worked out by Plexo: `var(--plx-on-accent)` (readable text on the main button colour), `var(--plx-accent)`.
- Components as Plexo-prefixed classes: `.plx-brand-button`, `.plx-brand-button--secondary`, `.plx-brand-card`,
  `.plx-brand-card__title`, `.plx-brand-alert--error`, `.plx-brand-badge` … (never Strata's unprefixed class names, so a site's own
  `.button` is never touched).
- The brand's fonts are loaded by the sheet itself.

## Generator

`brandStylesheet(designSystem, { selector?, dark?, components?, classPrefix?, fonts? })` in `@charisol/plexo-sdk/v2/compile` is the
single source of truth (pure: design system → CSS). `selector` scopes it to an element and `dark` adds a dark set
(`prefers-color-scheme: dark` unless `data-theme="light"`, and `[data-theme="dark"]`) — for reusing it in Plexo's own dashboard.

## Configuration

- `STRATA_API_URL` (existing).
- `STRATA_WEBHOOK_URL` (optional): where Strata should deliver; defaults to `NEXT_PUBLIC_APP_URL` + `/api/v1/strata/webhook`.
- Webhook secrets are issued by Strata per subscription and stored encrypted with `STRATA_TOKEN_ENCRYPTION_SECRET` (existing).
