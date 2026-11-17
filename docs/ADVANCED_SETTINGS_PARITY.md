# Advanced settings parity (old per-site page -> new dashboard)

The old dashboard had one per-site page (`/dashboard/templates/[id]/detail`) plus the app builder's own panes
(`/dashboard/apps/[id]`). On the new dashboard the old per-site page redirects into the site hub, and its
"Advanced site settings" link went to nowhere useful. Pros lost SEO, code, GitHub and more.

Rule (owner, final): advanced settings must not send the owner anywhere else. They are **shown right in the hub**.

## Where it lives now

- **Hub tab "Advanced"**, shown to **pros only**. `hubTabs()` adds it only for `experience === "pro"`; `?tab=advanced`
  for anyone else falls back to the first tab. Beginners and intermediate people never see it: what they need day to
  day (name, address, look, form replies, old links) stays in Settings, unchanged.
  Decision for intermediate: nothing extra. Their Settings tab keeps linking to the simple pages. Revisit if they ask.
- Left list of sections (a scrolling row on a phone), one section on the right: `?tab=advanced&section=<id>`.
- Which sections show is pure logic: `lib/dashboardV3/hubAdvanced.ts` (tests: `tests/hubAdvanced.test.ts`).
  Three kinds: **site** (visual or own-code website), **app** (app builder), **hosted** (server or static app the
  owner brought).
- The Settings tab's "Advanced" card now points to this area. For pros with a website, Form replies, Old links,
  Top and bottom of every page, Bring in pages and Your own lists open the matching Advanced section instead of an
  old page. Everyone else keeps the old links; old routes still work for the old dashboard.
- Old screens are shown in place with `Embed` (`app/dashboard/_v3/hub/advanced/Embed.tsx`): the old component, wrapped
  with the editor colour tokens and `LegacyBridge`, so it takes the brand colours in light and dark and has no page
  padding or back link of its own (`EmbeddedScreen` in `_components/PageContainer.tsx`). Nothing in the old pages
  changed for the old dashboard.

## Sections per kind

| Kind | Sections (in order) |
| --- | --- |
| Website | Search and sharing, Code, What is switched on, Header and footer, Your own lists, Forms, Old links, Scripts and embeds, Versions, Deploy and server, (Variables and secrets, when the plan has servers), Copy move or bring in, Delete |
| App builder app | App settings, Code, Data, Server code and logs, Secret keys, People, History, Publish, GitHub, Delete |
| Hosted app (server) | Deploy and server, Variables and secrets, GitHub, Delete |
| Hosted app (static files) | Deploy and server, Delete |

## The table: every old setting or tool

Status: **Inline** = now in the hub Advanced area. **Hub** = already in a hub tab. **Editor** = lives in the visual or
app editor, which is a workspace and not a setting. **Auto** = Plexo does it, there is nothing to set. **Dropped** =
removed on purpose.

### Old per-site page (`detail-client.tsx` and its panels)

| Old setting or tool | In the new dashboard today | What was done |
| --- | --- | --- |
| Rename the site | Hub > Settings > General | Already there. |
| Open editor | "Edit design" / "Update app" buttons in the hub header | Already there. |
| Preview (live page switcher) | Hub > Pages, "Visit site", "Edit design" | **Dropped** the in-page iframe; the real site and the editor are one click away. |
| View source (HTML, design JSON, plain text, copy) | Advanced > Code | **Inline**, per page, with Copy. `GET /api/templates/[id]` gained `?include=design` for the design data. |
| Properties: created, last compiled | Not shown | **Dropped** (no use to an owner). Saved dates show in Versions. |
| Version history: list, restore, delete | Advanced > Versions | **Inline**, per page. |
| Switch kind (page <-> email) | Not applicable | Emails are managed in the Emails library. Not ported. |
| Brand panel (link a Strata project, colours) | Hub > Brand | Already there. |
| Site appearance: browser-tab title, small icon, description, share picture | Hub > Brand (title, description, icon) and Advanced > Search and sharing (all four, **plus every page**) | **Inline**. Share picture was missing in the new look; per-page values are new (`/api/v1/templates/[id]/page-seo`). |
| Domain and traffic: web address, 30-day views | Hub > Web address, Hub > Visits | Already there (pros see Visits). |
| Site modules: Site layout | Advanced > Header and footer | **Inline** (the old screen; editing the header or footer itself opens the editor). |
| Site modules: Blog | Hub > Blog tab (when on); "Add a blog" in Pages | Already there. Advanced > What is switched on shows on/off and links to it. |
| Site modules: Commerce | Hub > Products, Orders; Shop settings | Already there. "Shop settings" stays its own screen (payments, delivery, discounts, notifications are a product area with its own pages); linked from What is switched on. |
| Site modules: Content types | Advanced > Your own lists | **Inline** (add, edit, delete lists; "Manage entries" still opens that list's entries page, an old screen). |
| Pages count, Manage pages | Hub > Pages | Already there. |
| Form submissions + where they go (MailDrip, webhook) | Advanced > Forms; Settings > Form replies for non-pros | **Inline**. |
| Redirects | Advanced > Old links | **Inline**. |
| Duplicate site | Advanced > Copy, move or bring in | **Inline**; opens the copy in its own hub. |
| Transfer site | Advanced > Copy, move or bring in | **Inline** (old screen). |
| Deploy (static app upload, hosting tier) | Hub > App tab (quick upload) and Advanced > Deploy and server (full uploader) | **Inline**. The "file is big, use the full uploader" link now goes to Advanced for pros instead of `?classic=1`. |
| Server app: build, log, rebuild, always-on, upload | Hub > App tab and Advanced > Deploy and server | **Inline**. The App tab component takes an `only` part so there is no duplicate code. |
| Variables and secrets | Hub > App tab and Advanced > Variables and secrets | **Inline**. Plain websites on a plan with servers get the old panel in place. |
| GitHub connection for server apps | Hub > App tab and Advanced > GitHub | **Inline**. Websites never had GitHub in the old dashboard, so none is added. |
| Danger zone: delete | Hub > Settings > Delete and Advanced > Delete | **Inline**. |

### Pieces inside the editors that owners reached from the detail page

| Old tool | Today | What was done |
| --- | --- | --- |
| Raw file editor (own-code pages): list, edit, save files | Advanced > Code | **Inline** with a code editor. Adding or uploading new files and replacing the whole upload stay in the editor. |
| Raw text content editor | Editor | Not a setting. Stays in "Edit design". |
| AI edit panel for own code | Ask SOL | Replaced by SOL in the new dashboard. |
| Script access (staff-approved script preview) | Advanced > Scripts and embeds | **Inline** (old control, in place). |
| Embed code modal (shop grid, buy button, form connector, lists) | Advanced > Scripts and embeds | **Inline**, copy only (it cannot add to a page from here). |
| Page settings in the visual editor: name, address, search details | Hub > Pages (name, address) and Advanced > Search and sharing (title, description, share picture) | **Inline**. |
| Page settings: your own script (per page) | Editor > Page settings | Kept in the editor (it is saved with the page design and goes through its draft). Mentioned in Scripts and embeds. |
| Pages panel: eject to own code, reset to builder | Editor > Pages | Stays in the editor on purpose: a one-way conversion should not sit next to settings. |
| Comments and mentions | Editor | Not a setting. |
| Site import (from Wix, WordPress and others) | Advanced > Copy, move or bring in | **Inline**. |

### Settings the old dashboard never had (the owner listed them)

| Wanted | Honest answer |
| --- | --- |
| Canonical address | **Auto**: every page names its own address (skipped when the page already has one). Shown as a fact in Search and sharing. |
| Sitemap, robots file | **Auto**: `/sitemap.xml` and `/robots.txt` for every site. Linked in Search and sharing. A page whose own code says noindex is left out. Preview addresses are noindex. |
| noindex toggle per page | Not in the old dashboard either. Own-code pages carry it in their code. Not invented. |
| Structured data | **Auto**: a basic website description is added to every page. No editor existed. |
| Analytics ids, site-wide head/body scripts | Not in the old dashboard (platform-wide tag only). Not invented. A page's own script is in the editor. |
| Caching | No per-site cache setting existed. The only related option is the hosting tier in the old Deploy panel, which is now inline. |

### App builder panes (`app/dashboard/apps/_components`)

| Old pane | Today | What was done |
| --- | --- | --- |
| Preview | App editor | The running app. Stays in "Edit design". |
| Design, Chat | App editor | The workspace for making the app. Stays in "Edit design" and Ask SOL. |
| Settings: General, Search and sharing (incl. Google and Bing verification), Sign-in, Files, Delete app | Advanced > App settings | **Inline**. |
| Code | Advanced > Code | **Inline**; saving rebuilds the preview shortly after, as the editor does. |
| Database (tables, SQL) | Advanced > Data | **Inline**. |
| Functions and logs | Advanced > Server code and logs | **Inline**. |
| Secrets | Advanced > Secret keys | **Inline**. |
| Users | Advanced > People | **Inline**. |
| History (versions, builds, restore) | Advanced > History | **Inline**; restoring rebuilds the preview. |
| GitHub | Advanced > GitHub | **Inline**. |
| Publish | Advanced > Publish | **Inline**: status, addresses, and the publish dialog. |

## Not ported, and why

- Comments, AI panels, the text editor and the Pages panel conversions: part of making the site, not settings.
- The Preview iframe: replaced by "Visit site" and the editor.
- Adding or replacing files in an own-code page, "Manage entries" for a list, and editing a header or footer open
  their own editor. They are editing work, not configuration.
- Analytics ids, caching, noindex, head scripts: the old dashboard never had them (see above).

## Quality bar

- Tokens only under `app/dashboard/_v3` (the colour-literal test passes); the embedded old screens get the brand tokens
  through the existing editor and legacy bridges, light and dark.
- Plain headings, one line of help for each section; 44px targets for the section list, buttons and file chips.
- Phone: the section list becomes a scrolling row and keeps the chosen section in view.
