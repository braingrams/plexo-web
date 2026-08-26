import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";

import { prisma } from "@/server/prisma";
import { auth } from "@/server/auth";
import { ensureActiveOrganization } from "@/server/org";
import { resolveUser } from "@/app/api/v1/domains/route";
import { isValidUuid } from "@/server/slug";
import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";

/**
 * Walks Template.parentId up to the site's root (parentId === null), the same walk
 * app/dashboard/templates/[id]/page.tsx and server/slug.ts each already inline their own
 * copy of. A third caller (this file) is the signal to factor it out — takes the starting
 * row's own id/parentId (already in hand at every call site) so it never re-fetches the
 * row the caller just loaded.
 */
export async function findRootTemplateId(id: string, parentId: string | null): Promise<string> {
  let rootId = id;
  let walkParentId = parentId;
  while (walkParentId) {
    const parent = await prisma.template.findUnique({ where: { id: walkParentId }, select: { id: true, parentId: true } });
    if (!parent) break;
    rootId = parent.id;
    walkParentId = parent.parentId;
  }
  return rootId;
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
  const layout = await prisma.siteLayout.findUnique({
    where: { templateId: rootTemplateId },
    select: {
      enabled: true,
      headerTemplate: { select: { designJson: true } },
      footerTemplate: { select: { designJson: true } },
    },
  });
  if (!layout?.enabled) return null;
  return {
    headerRows: extractRows(layout.headerTemplate?.designJson),
    footerRows: extractRows(layout.footerTemplate?.designJson),
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
  const rootId = await findRootTemplateId(template.id, template.parentId);
  const layout = await getEnabledSiteLayoutRows(rootId);
  return spliceLayoutRows(designJson, layout);
}

/**
 * Recompiles and re-persists compiledHtml for every LANDING_PAGE page under this site's
 * root (root included) against its CURRENT SiteLayout — call this once right after a
 * SiteLayout row's enabled/header/footer changes, and once after saving a Template that
 * turns out to be someone's header or footer fragment (see onSiteLayoutFragmentSaved
 * below). BFS over parentId rather than a single parentId-equals query so it's correct at
 * any page-tree depth, not just one level under the root.
 */
export async function recompileSiteLayoutDependents(rootTemplateId: string): Promise<void> {
  const layout = await getEnabledSiteLayoutRows(rootTemplateId);

  const pages: { id: string; designJson: unknown }[] = [];
  let frontier = [rootTemplateId];
  while (frontier.length > 0) {
    const rows = await prisma.template.findMany({
      where: { id: { in: frontier }, kind: "LANDING_PAGE", sourceType: "BUILDER", isSiteLayoutFragment: false },
      select: { id: true, designJson: true },
    });
    pages.push(...rows);
    const children = await prisma.template.findMany({
      where: { parentId: { in: frontier }, kind: "LANDING_PAGE", sourceType: "BUILDER", isSiteLayoutFragment: false },
      select: { id: true, designJson: true },
    });
    pages.push(...children);
    frontier = children.map((c) => c.id);
  }

  for (const page of pages) {
    const spliced = spliceLayoutRows(page.designJson, layout);
    let compiledHtml: string;
    try {
      compiledHtml = sanitizeHtml(compileToHTML(spliced));
    } catch {
      continue; // a malformed stored designJson shouldn't take the whole recompile pass down
    }
    await prisma.template.update({ where: { id: page.id }, data: { compiledHtml } });
  }
}

/**
 * Call after any Template save succeeds: cheap no-op unless the saved template happens to
 * be some site's header or footer fragment, in which case every page on that site needs
 * its compiledHtml recomputed to pick up the edit.
 */
export async function onTemplateSaved(templateId: string): Promise<void> {
  const dependents = await prisma.siteLayout.findMany({
    where: { enabled: true, OR: [{ headerTemplateId: templateId }, { footerTemplateId: templateId }] },
    select: { templateId: true },
  });
  for (const dep of dependents) {
    await recompileSiteLayoutDependents(dep.templateId);
  }
}

export type SiteLayoutAdminContext = {
  userId: string;
  organizationId: string;
  role: string | null;
  templateId: string;
};

/**
 * Every Site Layout admin route is scoped to a "site" (a root Template — parentId ===
 * null). Same shape as lib/blog/adminAuth.ts's resolveBlogAdminSite and
 * lib/commerce/adminAuth.ts's resolveCommerceAdmin, kept as its own copy rather than a
 * shared cross-domain helper, consistent with how those two didn't share one either.
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

  const site = await prisma.template.findFirst({
    where: { id: templateId, organizationId: resolved.organizationId, parentId: null },
    select: { id: true },
  });
  if (!site) {
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
 * org -> root-Template-ownership flow as lib/blog/pageAuth.ts's requireBlogSiteAccess.
 */
export async function requireSiteLayoutAccess(templateId: string, redirectPath: string): Promise<SiteLayoutPageAccess> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    redirect(`/auth/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const template = await prisma.template.findFirst({
    where: { id: templateId, organizationId: orgResolution.organizationId, parentId: null },
    select: { id: true, name: true },
  });
  if (!template) {
    notFound();
  }

  return { templateId: template.id, templateName: template.name, organizationId: orgResolution.organizationId };
}
