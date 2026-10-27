import { convertV1Design, type DocumentNode } from "@charisol/plexo-sdk/v2/compile";

import { compileTemplate } from "@/lib/compileTemplate";
import { Template, BlogSite, SiteLayout, type TemplateKind } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import type { V2LayoutSections } from "@/lib/v2/compile";
import { designFormatOf, isV2Design } from "@/lib/v2/design";

// Split out of lib/siteLayoutDynamo.ts so these pure, DynamoDB-only functions have NO
// `next/server`/`next/navigation` import anywhere in their own module or its import graph —
// siteLayoutDynamo.ts itself imports { NextRequest, NextResponse } from "next/server" and
// { redirect, notFound } from "next/navigation" for resolveSiteLayoutAdmin (a real API-route
// helper) and requireSiteLayoutAccess (a real Server Component page-access guard), and
// esbuild bundles a whole module's imports regardless of which export within it is actually
// used. lib/commerce/storefrontLayout.ts, lib/commerce/productDetailLayout.ts, and
// lib/lms/funnelStarterDesign.ts (all reachable from lambda/sol-chat/index.ts's standalone
// esbuild bundle via lib/ai/solAgent.ts -> lib/mcp/dispatchMcpTool.ts -> commerceTools.ts/
// lmsTools.ts) need getEnabledSiteLayoutRows/spliceLayoutRows but must never pull in
// next/server or next/navigation, which transitively drag in real Next.js server runtime
// code that requires "@opentelemetry/api" — an optional peer dependency Next.js handles
// internally, not a real dependency of this repo, so esbuild's standalone bundle fails to
// resolve it. siteLayoutDynamo.ts re-exports every one of these from here so every existing
// call site keeps working unchanged.

/**
 * Walks Template.parentId up to the site's root (parentId === null), the same walk
 * app/dashboard/templates/[id]/page.tsx and server/slugDynamo.ts each already inline their
 * own copy of. Takes the starting row's own id/parentId (already in hand at every call
 * site) so it never re-fetches the row the caller just loaded.
 */
export async function findRootTemplateId(id: string, parentId: string | null): Promise<string> {
  let rootId = id;
  let walkParentId = parentId;
  while (walkParentId) {
    const { data: parent } = await Template.get({ id: walkParentId }).go();
    if (!parent) break;
    rootId = parent.id;
    walkParentId = parent.parentId ?? null;
  }
  return rootId;
}

/**
 * A layout fragment Template (Blog's postLayoutTemplateId/listingLayoutTemplateId, Commerce's
 * productDetailTemplateId) is created with parentId: null — deliberately detached from the
 * page tree, since it's reused across many "pages" rather than being one itself. That means
 * findRootTemplateId's parentId walk can't find its site: given a null parentId it just
 * returns the fragment's own id, so getEnabledSiteLayoutRows looks up SiteLayout keyed to the
 * fragment instead of the real site root, finds nothing, and silently compiles it without a
 * header/footer. Every fragment's owning site is discoverable by reversing the FK that points
 * at it instead, so resolve that way whenever a template has no parent to walk.
 *
 * BlogSite/CommerceSettings have no index over postLayoutTemplateId/listingLayoutTemplateId/
 * productDetailTemplateId (both entities are keyed by templateId, the SITE's id, not the
 * fragment's) — this reverse lookup is rare enough (only fires for layout-fragment saves,
 * not ordinary page saves) that a bounded Scan is the honest v1 answer rather than a third
 * GSI on either entity for it.
 */
async function resolveLayoutFragmentRootId(templateId: string): Promise<string | null> {
  const [blogMatch, commerceMatch] = await Promise.all([
    BlogSite.scan
      .where(({ postLayoutTemplateId, listingLayoutTemplateId }, { eq }) =>
        `(${eq(postLayoutTemplateId, templateId)} OR ${eq(listingLayoutTemplateId, templateId)})`,
      )
      .go(),
    CommerceSettings.scan.where(({ productDetailTemplateId }, { eq }) => eq(productDetailTemplateId, templateId)).go(),
  ]);
  return blogMatch.data[0]?.templateId ?? commerceMatch.data[0]?.templateId ?? null;
}

/** A header/footer fragment as stored — its format decides how it is spliced (rows for V1, sections for V2). */
type LayoutSource = { designFormat: string | null | undefined; designJson: unknown } | null;
type LayoutRows = { headerRows: any[]; footerRows: any[]; headerSource?: LayoutSource; footerSource?: LayoutSource };

function extractRows(designJson: unknown): any[] {
  const rows = (designJson as { body?: { rows?: unknown } } | null)?.body?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** Null when there's no SiteLayout row for this site, or it exists but is turned off — the
 * layered gate: either way, callers should compile the page exactly as if this feature
 * didn't exist. */
export async function getEnabledSiteLayoutRows(rootTemplateId: string): Promise<LayoutRows | null> {
  const { data: layout } = await SiteLayout.get({ templateId: rootTemplateId }).go();
  if (!layout?.enabled) return null;
  const [header, footer] = await Promise.all([
    layout.headerTemplateId ? Template.get({ id: layout.headerTemplateId }).go() : null,
    layout.footerTemplateId ? Template.get({ id: layout.footerTemplateId }).go() : null,
  ]);
  const source = (t: typeof header): LayoutSource => (t?.data ? { designFormat: t.data.designFormat, designJson: t.data.designJson } : null);
  const rowsOf = (t: typeof header) => (t?.data && designFormatOf(t.data) === "v2" ? [] : extractRows(t?.data?.designJson));
  return {
    headerRows: rowsOf(header),
    footerRows: rowsOf(footer),
    headerSource: source(header),
    footerSource: source(footer),
  };
}

/**
 * The layout as V2 sections. A V2 fragment contributes the sections of its one page; a
 * classic (V1) fragment on a V2 site is converted on the fly by the SDK's convertV1Design
 * (it never throws and keeps what it can), so a site whose header was built before the
 * switch still shows its header on its new pages instead of silently losing it.
 */
export function layoutSectionsOf(layout: LayoutRows | null): V2LayoutSections | null {
  if (!layout) return null;
  const sectionsOf = (src: LayoutSource | undefined, which: "header" | "footer"): DocumentNode[] => {
    if (!src) return [];
    if (designFormatOf(src) === "v2") {
      return isV2Design(src.designJson) ? (src.designJson.pages[0]?.rootNode.children ?? []) : [];
    }
    if (extractRows(src.designJson).length === 0) return [];
    try {
      return convertV1Design(src.designJson, { id: `layout-${which}` }).page.rootNode.children ?? [];
    } catch {
      return [];
    }
  };
  return { headerSections: sectionsOf(layout.headerSource, "header"), footerSections: sectionsOf(layout.footerSource, "footer") };
}

/** Pure — returns designJson unchanged (same reference) when there's nothing to splice. */
export function spliceLayoutRows(designJson: any, layout: LayoutRows | null): any {
  if (!layout || (layout.headerRows.length === 0 && layout.footerRows.length === 0)) return designJson;
  const ownRows = extractRows(designJson);
  return {
    ...designJson,
    body: { ...designJson.body, rows: [...layout.headerRows, ...ownRows, ...layout.footerRows] },
  };
}

/**
 * The one call ordinary page saves need: resolves the site's root, looks up its
 * SiteLayout, and returns designJson with header/footer rows spliced in when enabled —
 * unchanged otherwise. Compile the RETURN VALUE, not the original designJson, but persist
 * the ORIGINAL designJson to Template.designJson (the page's own content only; header/
 * footer rows never get baked into a page's stored designJson, so editing stays scoped to
 * that page and the header/footer stay editable in exactly one place).
 */
export async function compileWithSiteLayout(template: { id: string; parentId: string | null }, designJson: any): Promise<any> {
  const rootId = await resolveRootId(template);
  const layout = await getEnabledSiteLayoutRows(rootId);
  return spliceLayoutRows(designJson, layout);
}

async function resolveRootId(template: { id: string; parentId?: string | null }): Promise<string> {
  return template.parentId
    ? await findRootTemplateId(template.id, template.parentId)
    : ((await resolveLayoutFragmentRootId(template.id)) ?? template.id);
}

/**
 * compileWithSiteLayout + the compile itself, for a template of EITHER format: V1 splices
 * header/footer ROWS into designJson and compiles it exactly as before; V2 splices header/
 * footer SECTIONS around its page. Persist the ORIGINAL designJson, store the RETURN VALUE
 * as compiledHtml. `designJson` defaults to the row's own (pass the draft when publishing one).
 */
export async function compileTemplateWithSiteLayout(
  template: { id: string; parentId?: string | null; kind: TemplateKind; name?: string; designFormat?: string | null; designJson?: unknown },
  designJson: unknown = template.designJson,
): Promise<string> {
  const rootId = await resolveRootId(template);
  const layout = await getEnabledSiteLayoutRows(rootId);
  if (designFormatOf(template) === "v2") {
    return compileTemplate({ ...template, designJson }, { rootTemplateId: rootId, layout: layoutSectionsOf(layout) });
  }
  return compileTemplate({ ...template, designJson: spliceLayoutRows(designJson, layout) }, { rootTemplateId: rootId });
}

/**
 * Recompiles and re-persists compiledHtml for every LANDING_PAGE page under this site's
 * root (root included) against its CURRENT SiteLayout — call this once right after a
 * SiteLayout row's enabled/header/footer changes, and once after saving a Template that
 * turns out to be someone's header or footer fragment (see onTemplateSaved below). BFS
 * over parentId (via Template.byParent GSI2) rather than a single query so it's correct at
 * any page-tree depth, not just one level under the root.
 */
export async function recompileSiteLayoutDependents(rootTemplateId: string): Promise<void> {
  const layout = await getEnabledSiteLayoutRows(rootTemplateId);

  type PageToCompile = { id: string; name: string; designFormat?: string | null; designJson: unknown };
  const asPage = (t: { id: string; name: string; designFormat?: string | null; designJson: unknown }): PageToCompile => ({
    id: t.id,
    name: t.name,
    designFormat: t.designFormat,
    designJson: t.designJson,
  });
  const pages: PageToCompile[] = [];
  const { data: root } = await Template.get({ id: rootTemplateId }).go();
  if (root && root.kind === "LANDING_PAGE" && root.sourceType === "BUILDER" && !root.isSiteLayoutFragment) {
    pages.push(asPage(root));
  }

  let frontier = [rootTemplateId];
  while (frontier.length > 0) {
    const childBatches = await Promise.all(frontier.map((parentId) => Template.query.byParent({ parentId }).go({ pages: "all" })));
    const children = childBatches.flatMap((b) => b.data);
    pages.push(
      ...children
        .filter((c) => c.kind === "LANDING_PAGE" && c.sourceType === "BUILDER" && !c.isSiteLayoutFragment)
        .map(asPage),
    );
    frontier = children.map((c) => c.id);
  }

  // Layout fragments (Blog's post/listing layout, Commerce's product detail layout) live
  // outside the page tree above (parentId: null — see resolveLayoutFragmentRootId) but still
  // need their compiledHtml re-spliced whenever this site's header/footer changes.
  const [{ data: blogSite }, { data: commerceSettings }] = await Promise.all([
    BlogSite.get({ templateId: rootTemplateId }).go(),
    CommerceSettings.get({ templateId: rootTemplateId }).go(),
  ]);
  const fragmentIds = [blogSite?.postLayoutTemplateId, blogSite?.listingLayoutTemplateId, commerceSettings?.productDetailTemplateId].filter(
    (id): id is string => Boolean(id),
  );
  if (fragmentIds.length > 0) {
    const fragments = await Promise.all(fragmentIds.map((id) => Template.get({ id }).go()));
    pages.push(...fragments.map((f) => f.data).filter((f): f is NonNullable<typeof f> => f !== null).map(asPage));
  }

  const layoutSections = layoutSectionsOf(layout);
  for (const page of pages) {
    let compiledHtml: string;
    try {
      compiledHtml =
        designFormatOf(page) === "v2"
          ? await compileTemplate({ ...page, kind: "LANDING_PAGE" }, { rootTemplateId, layout: layoutSections })
          : await compileTemplate({ ...page, designJson: spliceLayoutRows(page.designJson, layout), kind: "LANDING_PAGE" }, { rootTemplateId });
    } catch {
      continue; // a malformed stored designJson shouldn't take the whole recompile pass down
    }
    await Template.patch({ id: page.id }).set({ compiledHtml }).go();
  }
}

/**
 * Call after any Template save succeeds: cheap no-op unless the saved template happens to
 * be some site's header or footer fragment, in which case every page on that site needs
 * its compiledHtml recomputed to pick up the edit.
 *
 * SiteLayout has no index over headerTemplateId/footerTemplateId (keyed by templateId, the
 * SITE's id) — same bounded-Scan reasoning as resolveLayoutFragmentRootId above: this only
 * fires on a header/footer fragment save, not on every ordinary page save.
 */
export async function onTemplateSaved(templateId: string): Promise<void> {
  const { data: dependents } = await SiteLayout.scan
    .where(
      ({ enabled, headerTemplateId, footerTemplateId }, { eq }) =>
        `${eq(enabled, true)} AND (${eq(headerTemplateId, templateId)} OR ${eq(footerTemplateId, templateId)})`,
    )
    .go();
  for (const dep of dependents) {
    await recompileSiteLayoutDependents(dep.templateId);
  }
}
