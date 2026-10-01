import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { compileWithSiteLayout } from "@/lib/siteLayoutDynamo";
import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { Template } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

/**
 * GET/PUT /api/v1/templates/[id]/site-meta
 *
 * The home page's favicon/browser-tab title/meta description/social share image — the
 * same designJson.body.style fields plexo-sdk's compiler.ts already reads (htmlTitle,
 * favicon, metaDescription, ogImageUrl — see NON_CSS_BODY_STYLE_KEYS), previously only
 * settable through the visual builder's own page-settings panel. A RAW_UPLOAD site has no
 * such panel at all, so this is the only place those owners could ever set these; this
 * route is the dashboard-level "site settings" surface for both site types, scoped
 * specifically to the root template (the home page) rather than every child page — a
 * visitor's browser tab/link-preview is driven by whichever page they're actually on, so
 * this covers the page most visitors land on first, not literally every page site-wide.
 *
 * Applies live immediately (recompiles + persists designJson/compiledHtml directly), unlike
 * the visual builder's own draft/publish flow (app/api/templates/update/[id]) — consistent
 * with every other settings-style route in this app (Commerce, Domains, Branding), none of
 * which go through a draft first either.
 */

type SiteMetaBody = {
  htmlTitle?: string;
  favicon?: string;
  metaDescription?: string;
  ogImageUrl?: string;
};

async function resolveRootTemplate(
  request: NextRequest,
  id: string,
): Promise<{ error: NextResponse; template?: undefined } | { error?: undefined; template: { id: string; organizationId: string; parentId?: string | null; designJson: unknown } }> {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId || template.parentId) {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }

  return { template };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const result = await resolveRootTemplate(request, id);
  if (result.error) return result.error;

  const style = (result.template.designJson as any)?.body?.style ?? {};
  return NextResponse.json({
    htmlTitle: style.htmlTitle ?? "",
    favicon: style.favicon ?? "",
    metaDescription: style.metaDescription ?? "",
    ogImageUrl: style.ogImageUrl ?? "",
  });
}

async function resolveUpdatableRootTemplate(
  request: NextRequest,
  id: string,
): Promise<{ error: NextResponse; template?: undefined } | { error?: undefined; template: { id: string; organizationId: string; parentId?: string | null; designJson: unknown } }> {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return { error: permissionError };

  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return { error: scopeError };
  }

  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId || template.parentId) {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }

  return { template };
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const result = await resolveUpdatableRootTemplate(request, id);
  if (result.error) return result.error;
  const { template } = result;

  const body = (await request.json().catch(() => ({}))) as SiteMetaBody;

  const designJson = JSON.parse(JSON.stringify(template.designJson ?? { body: { style: {}, rows: [] } }));
  designJson.body = designJson.body ?? { style: {}, rows: [] };
  designJson.body.style = designJson.body.style ?? {};

  if (body.htmlTitle !== undefined) designJson.body.style.htmlTitle = body.htmlTitle.trim().slice(0, 200);
  if (body.favicon !== undefined) designJson.body.style.favicon = body.favicon.trim();
  if (body.metaDescription !== undefined) designJson.body.style.metaDescription = body.metaDescription.trim().slice(0, 300);
  if (body.ogImageUrl !== undefined) designJson.body.style.ogImageUrl = body.ogImageUrl.trim();

  const spliced = await compileWithSiteLayout({ id: template.id, parentId: null }, designJson);
  const compiledHtml = sanitizeHtml(compileToHTML(spliced));

  await Template.patch({ id: template.id })
    .set({ designJson, compiledHtml, compiledAt: new Date().toISOString() })
    .go();

  return NextResponse.json({ success: true });
}
