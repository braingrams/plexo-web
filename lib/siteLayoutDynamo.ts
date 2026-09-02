import { NextRequest, NextResponse } from "next/server";
import { redirect, notFound } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { resolveUser } from "@/lib/auth/resolveUser";
import { isValidUuid } from "@/lib/slugUtils";
import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { Template, BlogSite, SiteLayout } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import type { OrgRole } from "@/server/accessControl";

// DynamoDB-stack port of lib/siteLayout.ts — same behavior, same rationale on every
// function (see that file's comments), just backed by Template/BlogSite/CommerceSettings/
// SiteLayout entity queries instead of Prisma.

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

type LayoutRows = { headerRows: any[]; footerRows: any[] };

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
  return {
    headerRows: extractRows(header?.data?.designJson),
    footerRows: extractRows(footer?.data?.designJson),
  };
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
  const rootId = template.parentId
    ? await findRootTemplateId(template.id, template.parentId)
    : ((await resolveLayoutFragmentRootId(template.id)) ?? template.id);
  const layout = await getEnabledSiteLayoutRows(rootId);
  return spliceLayoutRows(designJson, layout);
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

  const pages: { id: string; designJson: unknown }[] = [];
  const { data: root } = await Template.get({ id: rootTemplateId }).go();
  if (root && root.kind === "LANDING_PAGE" && root.sourceType === "BUILDER" && !root.isSiteLayoutFragment) {
    pages.push({ id: root.id, designJson: root.designJson });
  }

  let frontier = [rootTemplateId];
  while (frontier.length > 0) {
    const childBatches = await Promise.all(frontier.map((parentId) => Template.query.byParent({ parentId }).go()));
    const children = childBatches.flatMap((b) => b.data);
    pages.push(
      ...children
        .filter((c) => c.kind === "LANDING_PAGE" && c.sourceType === "BUILDER" && !c.isSiteLayoutFragment)
        .map((c) => ({ id: c.id, designJson: c.designJson })),
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
    pages.push(...fragments.map((f) => f.data).filter((f): f is NonNullable<typeof f> => f !== null).map((f) => ({ id: f.id, designJson: f.designJson })));
  }

  for (const page of pages) {
    const spliced = spliceLayoutRows(page.designJson, layout);
    let compiledHtml: string;
    try {
      compiledHtml = sanitizeHtml(compileToHTML(spliced));
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

export type SiteLayoutAdminContext = {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  templateId: string;
};

/**
 * Every Site Layout admin route is scoped to a "site" (a root Template — parentId ===
 * null). Same shape as lib/blog/pageAuthDynamo.ts's resolveBlogAdminSite and
 * lib/commerce/adminAuthDynamo.ts's resolveCommerceAdmin, kept as its own copy rather than
 * a shared cross-domain helper, consistent with how those two didn't share one either.
 */
export async function resolveSiteLayoutAdmin(
  request: NextRequest,
  templateId: string,
): Promise<{ context: SiteLayoutAdminContext } | { error: NextResponse }> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isValidUuid(templateId)) {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }

  const { data: site } = await Template.get({ id: templateId }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }

  return {
    context: { userId: resolved.userId, organizationId: resolved.organizationId, role: resolved.role, templateId: site.id },
  };
}

export interface SiteLayoutPageAccess {
  templateId: string;
  templateName: string;
  organizationId: string;
}

/**
 * Shared by app/dashboard/templates/[id]/site-layout/page.tsx — same session -> active
 * org -> root-Template-ownership flow as lib/blog/pageAuthDynamo.ts's requireBlogSiteAccess.
 */
export async function requireSiteLayoutAccess(templateId: string, redirectPath: string): Promise<SiteLayoutPageAccess> {
  const session = await auth();
  if (!session?.user) {
    redirect(`/auth/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== orgResolution.organizationId || template.parentId) {
    notFound();
  }

  return { templateId: template.id, templateName: template.name, organizationId: orgResolution.organizationId };
}
