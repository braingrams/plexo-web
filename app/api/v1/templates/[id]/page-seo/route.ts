import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { getPageTree, pathForPage } from "@/server/slugDynamo";
import { compileTemplateWithSiteLayout } from "@/lib/siteLayoutDynamo";
import { designFormatOf, isV2Design } from "@/lib/v2/design";
import { Template } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

/**
 * GET/PUT /api/v1/templates/[id]/page-seo   ([id] is the site's home page)
 *
 * Search and sharing details for EVERY page of the site, in one place: the browser-tab title, the one-sentence
 * description and the social share image of each page. /site-meta covers the home page alone (plus the small
 * icon); this is the same data per page, which the page editor's own settings panel was the only way to reach.
 * Pages the owner wrote as their own code carry these in their HTML, so they are listed but not editable here.
 */
const MAX_PAGES = 200;

type Row = { id: string; name: string; path: string; isRaw: boolean; isRoot: boolean; title: string; description: string; image: string };

const styleOf = (t: { designJson: unknown }): Record<string, string> => (isV2Design(t.designJson) ? (t.designJson.meta ?? {}) : ((t.designJson as { body?: { style?: Record<string, string> } } | null)?.body?.style ?? {})) as Record<string, string>;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const tree = await getPageTree(resolved.organizationId, id);
  if (!tree || tree.rootId !== id) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const pages = tree.pages.slice(0, MAX_PAGES);
  const rows: Row[] = await Promise.all(
    pages.map(async (p): Promise<Row> => {
      const isRoot = p.id === tree.rootId;
      const path = isRoot ? "/" : `/${pathForPage(p.id, tree.pages)}`.replace(/\/+/g, "/");
      const isRaw = p.sourceType === "RAW_UPLOAD";
      if (isRaw) return { id: p.id, name: p.name, path, isRaw, isRoot, title: "", description: "", image: "" };
      const { data: t } = await Template.get({ id: p.id }).go();
      const s = t ? styleOf(t) : {};
      return { id: p.id, name: p.name, path, isRaw, isRoot, title: s.htmlTitle ?? "", description: s.metaDescription ?? "", image: s.ogImageUrl ?? "" };
    }),
  );
  rows.sort((a, b) => (a.isRoot === b.isRoot ? a.path.localeCompare(b.path) : a.isRoot ? -1 : 1));
  return NextResponse.json({ pages: rows, truncated: tree.pages.length > MAX_PAGES });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;
  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }

  const body = (await request.json().catch(() => ({}))) as { pageId?: string; htmlTitle?: string; metaDescription?: string; ogImageUrl?: string };
  if (!body.pageId) return NextResponse.json({ error: "Choose which page to change." }, { status: 400 });
  const tree = await getPageTree(resolved.organizationId, id);
  if (!tree || tree.rootId !== id || !tree.pages.some((p) => p.id === body.pageId)) return NextResponse.json({ error: "That page is not part of this site." }, { status: 404 });

  const { data: template } = await Template.get({ id: body.pageId }).go();
  if (!template || template.organizationId !== resolved.organizationId) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  if (template.sourceType === "RAW_UPLOAD") return NextResponse.json({ error: "This page is your own code. Change its title and description in the page's code." }, { status: 400 });

  const isV2 = designFormatOf(template) === "v2";
  const designJson = JSON.parse(JSON.stringify(template.designJson ?? (isV2 ? {} : { body: { style: {}, rows: [] } })));
  let target: Record<string, unknown>;
  if (isV2) {
    designJson.meta = designJson.meta ?? {};
    target = designJson.meta;
  } else {
    designJson.body = designJson.body ?? { style: {}, rows: [] };
    designJson.body.style = designJson.body.style ?? {};
    target = designJson.body.style;
  }
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
  const t = text(body.htmlTitle, 200);
  const d = text(body.metaDescription, 300);
  const img = text(body.ogImageUrl, 2000);
  if (t !== undefined) target.htmlTitle = t;
  if (d !== undefined) target.metaDescription = d;
  if (img !== undefined) target.ogImageUrl = img;

  let compiledHtml: string;
  try {
    compiledHtml = await compileTemplateWithSiteLayout(template, designJson);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "This page couldn't be rebuilt." }, { status: 400 });
  }
  await Template.patch({ id: template.id }).set({ designJson, compiledHtml, compiledAt: new Date().toISOString() }).go();
  return NextResponse.json({ success: true });
}
