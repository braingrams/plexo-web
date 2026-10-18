# V2 templates: storage, compile, publish, serve (Phase 1)

V2 (the SDK's visual editor) is becoming the only visual editor. During the dual-format period every
`Template` row says which format it holds. Existing rows are untouched and keep working as V1.

## Data contract

`Template.designFormat` / `TemplateRevision.designFormat`: `"v1" | "v2"`. Template defaults to `"v1"` on create;
rows written before the field existed have none. Always read with `designFormatOf(row)` (missing = `"v1"`).
EMAIL templates are always v1. Raw-HTML pages (`sourceType: "RAW_UPLOAD"`) are not visual and stay v1.

A v2 row keeps its design in the **same columns V1 uses** (`designJson` live, `draftJson` working copy,
`TemplateRevision.designJson` history):

```ts
{ format: "plexo-v2@1",
  pages: [PageDefinition],        // EXACTLY one: one Template row = one site page (like V1's parentId tree)
  designSystem?: DesignSystem,    // omitted while it equals the built-in one (that is ~84 KB)
  customJs?: string,              // owner's own script, <= 100,000 chars
  meta?: { htmlTitle?, favicon?, metaDescription?, ogImageUrl? } }   // V1 kept these in body.style
```

Multi-page: a site is still a tree of Template rows (`parentId`, `slug`, `order`); the home page is the root row
and its `compiledHtml` is what the domain serves at `/`. The editor shows several pages by loading the rows, it does
not put them in one JSON. Header/footer (`SiteLayout`) fragments are separate rows; their sections are spliced around
the page at compile time only (V1 splices rows, V2 splices sections) and never stored in a page.

`compiledHtml` for v2 is a complete sanitised HTML document (not a fragment).

## Code map

- `lib/v2/design.ts`: `isV2Design`, `parseV2Design` (SDK `parsePages` + caps: 120k chars design, one page), `designFormatOf`,
  `defaultDesignFormat()` (env `TEMPLATES_V2_NEW`), `blankV2Design`, `v2DesignFromTemplate`.
- `lib/v2/compile.ts`: `compileV2Design` = `compilePageToHtml` -> `sanitizeV2Html` -> owner script + head meta (after sanitising).
- `lib/compileTemplate.ts`: `compileTemplate()` dispatcher (v1 = `compileDesignJsonForKind`, unchanged output).
- `lib/siteLayoutCore.ts`: `compileTemplateWithSiteLayout()`, `recompileSiteLayoutDependents()` handle both formats.
  A classic header on a V2 page is converted with the SDK's `convertV1Design`.
- `lib/v2/forms.ts`: find forms in a v2 design, restore field labels. `lib/v2/copy.ts`: rebuild copies.

## Flows (V1 path unchanged)

- Autosave `POST /api/templates/update/:id`: v2 validates `parseV2Design`, compiles the draft server-side.
- Publish `POST /api/templates/:id/publish`, restore, `PUT /api/v1/templates/:id`, `POST /api/v1/publish`, site-meta,
  convert-type, siteLayout recompute: all go through the dispatcher. Restore/snapshot/publish carry `designFormat`.
- Classic write tools/payloads hitting a v2 page get a plain error naming `page_describe` / `page_edit` (added later).
- Creation (`POST /api/templates`): LANDING_PAGE root -> `defaultDesignFormat()`; sub-page -> its site's format; explicit
  `designFormat` only on a dashboard session call (no `Authorization` header); optional `pageTemplate` id.
- Serving `/pub`: v2 HTML never goes through V1's `sanitizeCompiledHtml`; blog/commerce/funnel markers
  (`data-plexo-*`) are the same ones the server already substitutes; custom JS is baked in (serve-time re-injection is V1 only).
- Forms: V2 forms post to `/api/public/forms/<siteRootId>/submit?form=<name>&page=<rowId>&fid=<nodeId>`; the route finds
  the form in the page's design to turn field ids back into labels; honeypot field `_hp_field` as in V1.

## Known gaps / later

No V2 MailDrip embed (no equivalent), commerce accent colour is not derived from a V2 design system yet, V1 -> V2
conversion is a later opt-in step (`convertV1Design`), Dynamo's 400 KB item cap is guarded only by the size limits above.
