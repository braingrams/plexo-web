# Strata components in Plexo (spec, phase 1)

## Correction and status (2026-11-18)

**The live link needs NO new runtime.** The hosted brand sheet `/__plexo/brand/<siteId>.css` already contains the brand's components as `.plx-brand-<name>` classes (the SDK's `brandComponentCss`: `.plx-brand-<name>`, `.plx-brand-<name>--<variant>`, parts as `.plx-brand-<name>__<role>`), and a components change already recompiles built pages (`runSiteBrandUpdate` + `rebuildPages` in `lib/brand/siteBrand.ts`). So `strata-web` / `<strata-dynamic>` and the pinned CDN script described under "Design" below are **not needed** and are dropped: a page uses a component by carrying its class, the sheet styles it, and a Strata publish reaches every page the same way tokens do (webhook, 15-minute sweep). Where the text below says `<strata-dynamic>`, read "an element with class `plx-brand-<name>`".

**Phase 1 is this work** (branch `feat/experience-switch-stats`), built in plexo-web:

| Piece | Where |
| --- | --- |
| Component catalogue per site (name, variants, slot roles), read from the stored design system the sheet is made from (no extra Strata call). Part of the resolved brand (`components`) and of `GET /api/v1/sites/[id]/brand` `resolved`. | `lib/brand/brandComponents.ts`, `lib/brand/brandModel.ts`, `lib/brand/resolveSiteBrand.ts` |
| SOL: catalogue in the per-turn "This site's brand" block with the rule "use the brand's ready-made components before inventing your own, say 'I'll use your brand's <name>' once, offer to save reusable things"; standing guide text; quality gate soft warning (`should`, never a failure) for a hand-made button or card on a site whose brand has one. | `lib/ai/solDiscovery.ts`, `lib/ai/solBrief.ts`, `lib/ai/solQuality.ts` |
| MCP tools for Claude, ChatGPT and any AI: `list_brand_components`, `create_brand_component` (validated; no overwrite unless `replace:true`), `get_brand_tokens`, `set_brand_tokens` (colours, fonts, radius, spacing; only existing or standard tokens). Server instructions say: the brand lives in Strata, use its components and tokens first, save new reusable things back. | `lib/mcp/brandTools.ts`, `lib/mcp/brandNote.ts` |
| Plexo to Strata for components and tokens made through SOL or MCP: `sendComponentsToStrata` / `sendTokensToStrata` (`POST`/`PATCH /projects/:id/components`, token push, then `POST /projects/:id/design-system/publish`, then Plexo's copy refreshed with `runSiteBrandUpdate(force)`). Same "keep the copy and retry" behaviour as colours and the logo: Strata unreachable means the change is kept on the site row (`pendingComponents`, `pendingTokens`, `pendingPush`), applied to Plexo's own copy and sheet at once, and sent on the next save, by the 15-minute sweep, on opening the Brand tab, or from "Send to Strata". A refusal by Strata (a rule of its own) is not retried: the reason is returned in plain words. | `lib/brand/extrasWriteThrough.ts`, `lib/brand/writeThrough.ts`, `lib/db/coreEntities.ts` |
| Brand tab: a "Ready-made pieces" card under the brand card (names, looks, parts) with "View in Strata". | `app/dashboard/_v3/hub/BrandTab.tsx` |

**Wired later, when the SDK release lands** (the SDK side is built in parallel in plexo-sdk and is not installed here yet):

- The editor element `brandComponent { name, variant, slots }`, and the SOL/`page_edit` commands `insertBrandComponent` and `saveAsBrandComponent`. `lib/mcp/v2Pages.ts` already answers those commands with a plain explanation; flip `BRAND_COMPONENT_COMMANDS_READY` in `lib/brand/brandComponentCommands.ts` and call `sendComponentsToStrata` with the component row the SDK builds (`componentFromSelection`). The steps are in that file.
- Automatic push of outgoing tokens and components from the editor (SDK `planSync` outgoing) is the SDK's; the server end it talks to is already here.
- Until then SOL and MCP can use components on raw HTML and apps (class `plx-brand-<name>`), and can save new ones with `create_brand_component`; a visual-editor page cannot place one yet.

Not verified against a real Strata (no sign-in was used): the exact `PATCH` body Strata accepts for an existing component beyond what its source shows (`name`, `variant`, `props`, `nodes`), and that `PUT /design-system` with `components: []` (the existing token push) leaves components alone.

## Decisions

Status: draft for review. Decisions from the product owner, 2026-11-18:

1. Components can be created from Plexo pages too, with Strata storing the real definition (not only from Figma).
2. A published page keeps a **live link** to Strata. When the component is published in Strata, every page using it updates by itself (no "update" button).
3. ~~Use `strata-web` (`<strata-dynamic>`) for the published page~~ (superseded: the hosted brand sheet is the live link, see the correction above); `strata-react` / `strata-mcp` for the editor and AI side.
4. SOL and any AI use the brand's components first; anything they build can be saved back into Strata.

## What already exists (verified in the repos, 2026-11-18)

- Strata backend: component definitions (props plus a node tree that references tokens), with create / update / delete / patch-node / preview routes (v1 and v2), and `GET /v1/sync/:id/components`.
- `@strata-ds/web`: `<strata-dynamic component="button" variant="primary">`, loaded from the CDN, fetches components and tokens from Strata and keeps them in sync.
- `@strata-ds/core` (strata-react): `useComponents()` / `<StrataComponent>`.
- `@strata-ds/mcp`: `list_components`, `get_component`.
- Plexo: brand link per site, keep-in-sync webhook + 15-minute sweep, the brand picker, the Strata session (Charisol sign-in).
- The Plexo brand project has **no components yet**; a Button and a Card are to be created for testing.

## Design

### On the page
A new editor element `strataComponent { projectId, name, variant, slots }`. On the canvas it renders from the project's published component definition. On the published page it compiles to:

```html
<strata-dynamic project="<id>" component="button" variant="primary" data-slots='{"label":"Book now"}'>
  <!-- static copy, rendered at publish time, so the page is complete without Strata or JavaScript -->
  <button class="...">Book now</button>
</strata-dynamic>
```
plus one pinned `strata-web` script on pages that use at least one component (none on other pages).

### Live updates
Only **published** Strata versions are served (never drafts), same rule as brand tokens. The static copy is refreshed by the existing webhook/sweep, so the stored page also follows.

### Safety
- Component definitions are a closed vocabulary (structure + token references + text/image/link slots). No scripts, no raw HTML.
- The `strata-web` script is pinned to a fixed major version.
- If Strata or the CDN is down, the static copy shows. Nothing breaks.
- Existing sites are untouched: only pages where the owner adds a Strata component are affected.

### Saving back
"Save to my brand" on a selection (or on what SOL built) turns it into a component definition (token references instead of raw colours where the value matches a token; text/image/link become slots) and creates or updates it in Strata through the existing session. Name clash = ask: update the existing component or save as a new one.

### SOL and other AI
SOL's brief gets the component catalogue (names, variants, slots) next to the brand block, with the rule: use the brand's components before inventing your own, and offer to save new patterns back. External AI uses `strata-mcp`.

## Phases
1. Insert a Strata component in the editor (canvas + published page with static copy + live link). SOL aware.
2. Save to my brand (selection -> component).
3. Brand switch carries components along (already follows the project link).

## Open questions
- Slot model for Plexo-made components: exact mapping from the V2 node tree to Strata's node tree.
- Whether `strata-web` can render on the server for the static copy, or Plexo renders its own from the same definition.
- Component versioning (pin vs follow latest) for the rare breaking change.
