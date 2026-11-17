# Strata brand across Plexo: what exists, what was missing, what changed

Plexo and Strata (Charisol's design-system tool) are connected, and the brand held in Strata is prioritised across the whole
product: site set-up, SOL, and external AI over MCP. This is the one honest page about how that works.

## The one precedence rule

> **linked Strata project  >  the site's own saved brand (Template.brand, the Brand tab)  >  the account's onboarding brand  >  defaults (nothing)**

Applied per kind of fact, so a site linked to a project that has no logo still shows the logo saved on the site: colours,
fonts and logo each come from the highest source that has them. It lives in ONE pure function,
`mergeBrand` in `lib/brand/brandModel.ts` (tested in `tests/brandModel.test.ts`). Each site links to its own project; one site's
brand never reaches another (SOL's site-resolution rules still decide which site a request is about).

## Data flow

```
Strata project ──(design system, published)──►  lib/brand/siteBrand.ts  (link / sync / unlink, webhook + 15-min sweep)
                                                  │  saves the design system + writes the hosted sheet /__plexo/brand/<siteId>.css
                                                  ▼
                              lib/brand/resolveSiteBrand.ts   ONE server-side resolver  (mergeBrand = the precedence rule)
                              resolveSiteBrand(siteId) · resolveBrandsForSites(rows) · tryResolveSiteBrand
                                                  │ ResolvedBrand { source, project, syncOn, colours(+roles), fonts, radius, logoUrl, voice, stylesheet }
        ┌───────────────┬──────────────┬──────────┴────────┬───────────────────┬──────────────────────┐
        ▼               ▼              ▼                   ▼                   ▼                      ▼
 Brand tab +      Home card +     SOL context        SOL quality gate     MCP tools              Pages, emails, apps
 GET .../brand    "Add logo &     (withSites →       (brief.colors/fonts  get_site_brand,        compileTemplate uses the linked
 (`resolved`)     colours" step   "This site's       from the same        link_site_brand,       design system; the hosted sheet
                  (homeData)      brand" block)      resolved brand)      site_create defaults   styles every page, app and static site
```

Strata → Plexo is automatic: publishing in Strata fires `design-system.published`, every linked site with "Keep in sync" on pulls,
rewrites its sheet (tokens go live in about a minute; components also rebuild built pages). Plexo → Strata is new work, below.

## Audit: what existed

| Piece | State |
| --- | --- |
| `lib/brand/siteBrand.ts` link / refresh mapping / sync / options / unlink, webhook, 15-minute sweep | Solid. Kept as is; extended (below). |
| `lib/brand/mapping.ts` (raw HTML / WordPress "use my brand"), `store.ts`, `inject.ts` | Fine, unchanged. |
| `app/api/v1/sites/[id]/brand` | Worked; returned only link state. Now also returns `resolved`. |
| Hub Brand tab Strata card + `createStrataAdapter` | Worked, but a plain select in a modal, and it read the brand by fetching and parsing the CSS sheet. |
| V2 editor "keep my website up to date" switch → `/brand` | Fine, unchanged (same route, same state). |
| Per-site manual brand (`Template.brand`, `LookCard`, `applyLook`, `saveLook`) | Fine; stays as the fallback rung. A site with no project works exactly as before. |
| Onboarding look step | A "Connect Strata" text link that connected but never linked or chose a project, so nothing happened afterwards. |
| New-site flow | No brand step at all. |
| SOL (`solSiteContext`, `solBrief`, `solDiscovery`, `solQuality`) | Read `Template.brand` + the account's onboarding brand only. Strata was invisible to SOL: it asked for colours on a linked site and built with its own palette. |
| MCP | `get_strata_tokens` read a PUBLIC project's snapshot via an account-level id on the User record. A separate, site-blind path that never knew a site's linked project. No tool listed projects, linked a site, or created a project. Server instructions did not exist. |
| Duplicated reading paths | Home card (`displayBrand`), Home facts (`readSiteBrand`), hub (`readSiteBrand`), Brand tab (parsed the CSS), SOL (`readSiteBrand`), `get_strata_tokens`. Six ways, three answers. |

## What was missing, and what I changed

1. **One resolver.** `lib/brand/brandModel.ts` (pure) + `lib/brand/resolveSiteBrand.ts` (server, no Next imports, so SOL's Lambda can use it).
   Used now by: the Brand tab and the `/brand` route (`resolved`), the Home brand card and the Home "Add your logo and colours" step
   (a linked brand ticks it), SOL's context (`withSites`), SOL's quality gate (through the brief), the MCP brand tools, `get_strata_tokens`
   (`siteId` returns the same resolved brand), `site_create` defaults. Email building has no site-brand reader of its own to replace:
   emails are written by the caller (SOL or an external AI) from `get_site_brand`, and Plexo's own transactional emails use Plexo's brand
   (`lib/brand/emailBrand.ts`), which is a different thing. App design tools already compile with the linked design system
   (`applyDesignSystem`), and `resolveSiteBrand` reads an app's design system from `src/plexo-canvas` like `siteBrand.ts` does.
2. **Strata projects, from Plexo.** `listOwnerStrataProjects`, and `createStrataProjectFromSiteBrand` (shared by the web UI and MCP):
   creates a project from Strata's base set in the site's main colour, then pushes the second colour, accent and fonts (`strataPushTokens`,
   pure) with the SDK's `push`, uploads the logo as a LOGO / PRIMARY asset, and links the site with Keep in sync ON. Refuses a site that
   already uses a project or has no colours. Every failure along the way becomes a plain-words note, never a half-made state.
   `linkSiteBrand` now reads the project's real name and logo from Strata (never from the caller) and stores the logo (`SiteBrand.projectLogo`).
3. **Picker** `StrataBrandPicker` (`app/dashboard/_v3/brand`), pure logic in `lib/dashboardV3/strataPicker.ts`. Two modes: `draft` (the site
   isn't made yet; reports the choice) and `site` (links or creates straight away, with the sync switch, default ON). States: loading,
   Strata off (renders nothing), not connected ("Connect Strata", skippable), error with retry, empty ("make one from my brand"), list.
   Used in the new-site flow (new "Your brand" step, left out entirely when Strata isn't on this Plexo), in onboarding's look step (where it
   said "Connect Strata"), and in the hub Brand tab (replaces the card and the select; every switch kept).
   After the site exists `applyNewSiteBrandChoice` links it (or creates the project) and a plain toast confirms.
4. **SOL.** `withSites` resolves each site's brand with the one resolver; the chosen site's brand arrives as a "This site's brand" block on
   every turn (colours with roles, fonts, radius, logo, voice, linked project, sync), not only on new builds, so a Strata change is seen on the
   very next turn. `BRAND_RULES_GUIDE` (system prompt): use it everywhere, say "I'll use your <brand> brand" once, never ask for colours,
   fonts or logo, on a new site with nothing known offer the owner's Strata projects. The brief now carries the linked fonts, so the intake
   never asks, and the quality gate checks the brand's main colour, fonts and logo (a page that takes its main colour from the brand's
   variables counts as applied for a linked site, because the hosted sheet defines them).
5. **MCP.** `lib/mcp/brandTools.ts`: `get_site_brand`, `list_strata_projects`, `link_site_brand`, `create_strata_project_from_brand` (same
   shared functions and the same limits as the web UI: 20 changes / window, 120 reads, edit access in Strata checked by Strata itself).
   `lib/mcp/brandNote.ts`: the server `instructions` (sent in `initialize`) and one sentence appended to every tool that creates or restyles
   something (22 tools). `site_create` fills missing colours, fonts, logo and tone from the saved brand and takes `strataProjectId` to link the
   new site. `get_strata_tokens` points at `get_site_brand`. Documented in `public/skills/SKILL.md`, `public/llms.txt`, `public/openapi.json`.

## Behaviour to know

- No Strata account / not connected: the picker offers "Connect Strata" and "Skip for now"; nothing else changes. If Strata isn't configured
  on this Plexo the new-site brand step and the onboarding link disappear.
- Voice: Strata holds none today, so `voice` is the account's onboarding "feel". When Strata gets one, add it in `brandFromDesignSystem`.
- A brand changed in Strata: new pages and SOL see it as soon as the sync stored it (about a minute after Publish); a logo replaced in Strata
  follows on the next publish (see "A logo replaced in Strata").
- Unlinking removes the sheet, so the site falls back to the next rung (its saved brand, then the account's).

## Strata side: done (Strata PR #301) and confirmed

1. **Publish from the API: built.** `POST /v1/projects/{projectId}/design-system/publish`, signed-in project owner only (the same rule as the editor's
   Publish), optional body `{ "message" }`. It runs the same code as the editor (`services/designSystemPublish.js`): version, snapshot, the
   `design-system.published` webhook. Idempotent: identical content and logo return the current version with `unchanged: true` and send nothing.
   Response `{ data: { projectId, published, unchanged, revision, version, publishedAt, message, logo, snapshotUrl } }`.
   Plexo calls it right after pushing tokens and the logo (`publishStrataProject`, with the owner's own session; the integration key is read-only).
2. **Asset contract: confirmed.** `type: "LOGO", role: "PRIMARY"` are valid Strata values (BrandAsset types include LOGO, roles include PRIMARY); the
   upload is multipart `POST /projects/{id}/assets` (`type`, `role`, `name`, `file`), editor role, up to 20 MB, no mime restriction (Plexo sends png/jpeg/webp/svg up
   to 5 MB). Strata copies that file's URL to the project's logo. A project's primary logo is its newest ACTIVE `LOGO` asset with role `PRIMARY`, else its newest
   ACTIVE logo (the logo given when a project is created has no role).
3. **How Plexo reads it back (stable field).** `data.logo = { assetId, url, mimeType, updatedAt } | null` on `GET design-system` and `GET design-system/revision`,
   both with the read-only integration key. With `?source=published` it is the logo as of that publish (recorded on the version). The `?source=published`,
   `NOT_PUBLISHED` and webhook subscription code is on Strata `main` (PR #299), so it ships with any merge to `main`.

## A logo replaced in Strata

Replace the logo in Strata and press Publish (a logo-only change is a real change to Strata's publish, so the webhook fires). On every sync (webhook or the
15-minute sweep) Plexo reads the logo with the same one small revision read it already makes (`/design-system/revision?source=published`, which now includes
`logo`), compares the asset id and address with `SiteBrand.projectLogo` / `projectLogoId`, and only when they differ it saves the new logo on the row (so SOL,
MCP and the Brand tab see it) and puts it in the site's shared header (`applySiteLogo`, V2 sites; classic, uploaded and app sites keep the logo in the brand only).
Unchanged = no writes. A Strata that reports no logo (or an older one) never removes the site's logo. A failed apply is not recorded, so the next sync retries.
The hosted sheet has no logo variable (it holds colours, fonts and component styles), so nothing there changes.

## A project made from a site's brand

Plexo creates the project, pushes colours/fonts, uploads the logo, then calls the publish endpoint and links the site to the PUBLISHED brand. If this Strata has no
such endpoint (404/405, or unreachable) or refuses, the site is linked anyway, marked `awaitingPublish`, and the owner reads: "Your brand is saved in Strata. Press
Publish there once to start keeping it in sync." Never an error screen. Every later refresh retries the publish (only for projects Plexo made, with the owner's
Strata session), and the waiting state clears as soon as anything is published.

## Not done / could not verify

- **Nothing was run against live Strata or Plexo production.** Everything Strata-facing (project list, create, push, logo upload, link) is
  covered by pure-logic tests and fixtures only. The first real run should be on a staging Strata with a throwaway account.
- Needs a live staging Strata: the publish endpoint and the `logo` field are covered by Strata's integration tests and Plexo's fixture tests
  (`tests/strataPublishAndLogo.test.ts`) only. Steps to check them for real are in `docs/STRATA_DEPLOY_CHECKLIST.md`.
- `lib/dashboardV3/hubBrand.ts` `brandLook` (CSS-sheet parser) is no longer used by the Brand tab; left in place for its tests.
- The new-site brand step uses the account's saved colours to decide whether "Create a Strata brand from mine" is on; a brand-new owner with
  none sees it explained, and can do it from the new site's Brand page.
- Dark mode of the picker follows the tokens; only the light theme was looked at in headless Chrome.

## Server apps and uploaded pages (follow-up)

**Server apps (built).** An app's HTML pages get the brand link from Plexo's serve layer when the owner switches on "Add my brand to my app" (Brand tab). It
is a new per-site flag, off for every app that was linked before; apps linked from now on have it on. `BRAND_SERVER_INJECT=off` disables it everywhere at once.
Same bytes and headers as before for: no flag, kill switch, JSON, errors, huge pages, pages that already link the sheet (tests/ssrBrandInject.test.ts).
There is no "Add my brand to my code" file-editing action: the injector makes it unnecessary, and a code write is the riskier way to get the same result.
SOL and MCP write app styles with the brand variables and keep the link in the layout (`BRAND_RULES_GUIDE`, `APP_CODE_BRAND_NOTE`).

**Logo in uploaded and WordPress pages (NOT built; recommendation).** Finding the logo in arbitrary customer HTML is a guess: themes use CSS background logos,
inline SVG, `<picture>`/lazy-load `data-src`, sticky-header duplicates (two logos), text-only headers, sprites and plugin-generated markup; an `<img>` named "logo" can be a
partner or client logo, and replacing the wrong image on a live customer page is visible and hard to notice. It also needs size handling (a new logo with a different aspect
ratio breaks a fixed-height header) and a per-page undo. That is more change and more risk than the benefit justifies. Smallest safe alternative: when SOL edits an uploaded
page it places the brand logo itself (it can see the page and the brand's `logoUrl`), and the owner sees and approves the edit like any other. Not done automatically.
A `--brand-logo-url` variable was also left out: the hosted sheet only changes when tokens change, a logo-only change would have to rewrite every linked site's sheet, and
that changes served output for sites that exist today.

## Existing sites are not touched by this change

- A site linked before logos were recorded gets its Strata logo recorded as a baseline on the first sync (row only); nothing is applied to its header. Only a later, different logo is applied.
- Server-app injection is opt-in per site (new flag) with a global kill switch; uploaded pages are unchanged.
