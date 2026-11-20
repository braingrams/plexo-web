import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { getPageTree } from "@/server/slugDynamo";
import { compileTemplateWithSiteLayout } from "@/lib/siteLayoutDynamo";
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { ensureBlankSiteLayout, fragmentIsBlank, siteKindForLayout, unsupportedLayoutMessage } from "@/lib/siteLayoutBlank";
import type { EntityItem } from "electrodb";
import { Member } from "@/lib/db/coreEntities";

/**
 * GET/PUT /api/v1/templates/[id]/page-chrome   ([id] is any page of the site)
 *
 * The "Show header" / "Show footer" switches in the editor's Page settings. Both are on unless the owner turns
 * one off for this page; the site's shared header and footer themselves are designed once and edited from the
 * links this returns. `ready` is false while the site has no shared header/footer switched on (the editor then
 * offers to add them).
 */
async function resolvePage(request: NextRequest, id: string): Promise<{ error: NextResponse } | { error?: undefined; resolved: NonNullable<Awaited<ReturnType<typeof resolveUser>>>; template: EntityItem<typeof Template>; rootId: string }> {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) };
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId || template.isSiteLayoutFragment) {
    return { error: NextResponse.json({ error: "Page not found." }, { status: 404 }) };
  }
  const tree = await getPageTree(resolved.organizationId, id);
  if (!tree) return { error: NextResponse.json({ error: "Page not found." }, { status: 404 }) };
  return { resolved, template, rootId: tree.rootId };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const r = await resolvePage(request, id);
  if (r.error) return r.error;
  // Older sites are given a blank header and footer the first time anyone opens the editor (nothing a visitor sees changes).
  const migrated = await ensureBlankSiteLayout(r.rootId, r.resolved.userId).catch(() => null);
  const { data: layout } = await SiteLayout.get({ templateId: r.rootId }).go();
  const ready = !!layout?.enabled && !!(layout.headerTemplateId || layout.footerTemplateId);
  const [headerBlank, footerBlank] = await Promise.all([fragmentIsBlank(layout?.headerTemplateId), fragmentIsBlank(layout?.footerTemplateId)]);
  const { data: rootRow } = await Template.get({ id: r.rootId }).go();
  const kind = siteKindForLayout(rootRow ?? r.template);
  return NextResponse.json({
    rootId: r.rootId,
    ready,
    headerBlank,
    footerBlank,
    siteKind: kind,
    unsupported: migrated?.status === "unsupported" ? unsupportedLayoutMessage(migrated.kind) : null,
    headerTemplateId: layout?.headerTemplateId ?? null,
    footerTemplateId: layout?.footerTemplateId ?? null,
    showHeader: !r.template.hideHeader,
    showFooter: !r.template.hideFooter,
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const r = await resolvePage(request, id);
  if (r.error) return r.error;
  const permissionError = requirePermission(r.resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;
  if (r.resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: r.resolved.organizationId, userId: r.resolved.userId }).go();
    const scopeError = requireTemplateScope(member, r.rootId);
    if (scopeError) return scopeError;
  }

  const body = (await request.json().catch(() => ({}))) as { showHeader?: unknown; showFooter?: unknown };
  const set: { hideHeader?: boolean; hideFooter?: boolean } = {};
  if (typeof body.showHeader === "boolean") set.hideHeader = !body.showHeader;
  if (typeof body.showFooter === "boolean") set.hideFooter = !body.showFooter;
  if (Object.keys(set).length === 0) return NextResponse.json({ error: "Choose whether to show the header or the footer." }, { status: 400 });

  if (r.template.sourceType === "RAW_UPLOAD") {
    return NextResponse.json({ error: "This page is your own code, so the site header and footer don't apply to it." }, { status: 400 });
  }

  let compiledHtml: string;
  try {
    compiledHtml = await compileTemplateWithSiteLayout({ ...r.template, ...set }, r.template.designJson);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "This page couldn't be rebuilt." }, { status: 400 });
  }
  await Template.patch({ id }).set({ ...set, compiledHtml, compiledAt: new Date().toISOString() }).go();
  return NextResponse.json({ showHeader: !(set.hideHeader ?? r.template.hideHeader), showFooter: !(set.hideFooter ?? r.template.hideFooter) });
}
