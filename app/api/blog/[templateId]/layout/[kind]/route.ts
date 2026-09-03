import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Template, BlogSite } from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";

const BLANK_TEMPLATE_SHELL = {
  body: {
    style: { background: "#ffffff", padding: "24px" },
    rows: [],
  },
};

type LayoutKind = "post" | "listing";

function isLayoutKind(value: string): value is LayoutKind {
  return value === "post" || value === "listing";
}

/**
 * Lists this org's OTHER blog sites' currently-attached layout of the same kind — reuse
 * candidates for "Use existing" instead of designing a new one from scratch. A layout only
 * shows up here while it's actually attached somewhere (BlogSite.*LayoutTemplateId set);
 * detaching one (see DELETE below) drops it out of this list even though the Template row
 * itself still exists.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; kind: string }> },
): Promise<NextResponse> {
  const { templateId, kind } = await context.params;
  if (!isLayoutKind(kind)) return NextResponse.json({ error: "Unknown layout kind." }, { status: 400 });

  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.context.organizationId }).go({ pages: "all" });
  const otherRoots = orgTemplates.filter((t) => !t.parentId && t.id !== resolved.context.templateId);

  const blogSites = await Promise.all(otherRoots.map((t) => BlogSite.get({ templateId: t.id }).go()));
  const layoutTemplateIds = blogSites
    .map((s) => (kind === "post" ? s.data?.postLayoutTemplateId : s.data?.listingLayoutTemplateId))
    .filter((id): id is string => !!id);

  if (layoutTemplateIds.length === 0) return NextResponse.json({ candidates: [] });

  const layoutTemplates = await Promise.all(layoutTemplateIds.map((id) => Template.get({ id }).go()));
  const nameById = new Map(otherRoots.map((t) => [t.id, t.name]));
  const siteIdByLayoutId = new Map(
    blogSites
      .map((s, i) => [kind === "post" ? s.data?.postLayoutTemplateId : s.data?.listingLayoutTemplateId, otherRoots[i].id] as const)
      .filter((entry): entry is [string, string] => !!entry[0]),
  );

  const candidates = layoutTemplates
    .map((r) => r.data)
    .filter((layout): layout is NonNullable<typeof layout> => !!layout)
    .map((layout) => ({
      layoutTemplateId: layout.id,
      layoutName: layout.name,
      siteName: nameById.get(siteIdByLayoutId.get(layout.id) ?? "") ?? "",
      updatedAt: layout.updatedAt,
    }));

  return NextResponse.json({ candidates });
}

/**
 * A layout is just an ordinary LANDING_PAGE Template with isBlogLayout: true — created
 * once and reused (idempotent: calling this again while one's already attached just
 * returns it, so re-clicking "Design custom layout" never creates duplicates). It's
 * attached to BlogSite immediately, even blank — the public renderer (lib/pub/blogLayoutRender.ts)
 * only actually substitutes into it once it finds the required marker block, and falls
 * back to the default theme otherwise, so there's no broken/dead-end state to guard
 * against here: designing, saving, and going live all happen through the same normal
 * builder autosave, no separate "activate" step needed.
 *
 * Optional body { sourceLayoutTemplateId } clones an existing layout (see GET above)
 * instead of starting blank — "Use existing" in the blog settings picker.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; kind: string }> },
): Promise<NextResponse> {
  const { templateId, kind } = await context.params;
  if (!isLayoutKind(kind)) return NextResponse.json({ error: "Unknown layout kind." }, { status: 400 });

  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = requirePermission(resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const { data: site } = await BlogSite.get({ templateId: resolved.context.templateId }).go();
  const existingId = kind === "post" ? site?.postLayoutTemplateId : site?.listingLayoutTemplateId;
  if (existingId) {
    return NextResponse.json({ layoutTemplateId: existingId });
  }

  const body = (await request.json().catch(() => ({}))) as { sourceLayoutTemplateId?: string };
  const sourceLayoutTemplateId = typeof body.sourceLayoutTemplateId === "string" ? body.sourceLayoutTemplateId.trim() : "";

  let name = kind === "post" ? "Blog Post Layout" : "Blog Listing Layout";
  let designJson: object = BLANK_TEMPLATE_SHELL;
  let compiledHtml = "";

  if (sourceLayoutTemplateId) {
    // Never trust a bare template id from the client — re-verify it the same way GET
    // surfaced it: it must be reachable as THIS EXACT KIND's attached layout on some
    // BlogSite belonging to the same organization. Prevents cross-org access and
    // kind-mismatches (e.g. cloning a listing layout into a post slot).
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.context.organizationId }).go({ pages: "all" });
    const roots = orgTemplates.filter((t) => !t.parentId);
    const blogSites = await Promise.all(roots.map((t) => BlogSite.get({ templateId: t.id }).go()));
    const isAttached = blogSites.some((s) =>
      kind === "post" ? s.data?.postLayoutTemplateId === sourceLayoutTemplateId : s.data?.listingLayoutTemplateId === sourceLayoutTemplateId,
    );
    const { data: source } = isAttached ? await Template.get({ id: sourceLayoutTemplateId }).go() : { data: null };
    if (!source) {
      return NextResponse.json({ error: "That layout is no longer available to reuse — it may have been detached from its site." }, { status: 400 });
    }
    name = source.name;
    designJson = source.designJson as object;
    compiledHtml = source.compiledHtml;
  }

  const layoutId = randomUUID();
  await Template.create({
    id: layoutId,
    userId: resolved.context.userId,
    organizationId: resolved.context.organizationId,
    name,
    kind: "LANDING_PAGE",
    isBlogLayout: true,
    designJson,
    compiledHtml,
  }).go();

  const layoutField = kind === "post" ? { postLayoutTemplateId: layoutId } : { listingLayoutTemplateId: layoutId };
  if (site) {
    await BlogSite.patch({ templateId: resolved.context.templateId }).set(layoutField).go();
  } else {
    await BlogSite.create({ id: randomUUID(), templateId: resolved.context.templateId, ...layoutField }).go();
  }

  return NextResponse.json({ layoutTemplateId: layoutId }, { status: 201 });
}

/** Detaches the layout (reverts to the default theme) without deleting the Template row — it stays around, editable, reattachable later via POST. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; kind: string }> },
): Promise<NextResponse> {
  const { templateId, kind } = await context.params;
  if (!isLayoutKind(kind)) return NextResponse.json({ error: "Unknown layout kind." }, { status: 400 });

  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = requirePermission(resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const { data: site } = await BlogSite.get({ templateId: resolved.context.templateId }).go();
  if (site) {
    await BlogSite.patch({ templateId: resolved.context.templateId })
      .remove(kind === "post" ? ["postLayoutTemplateId"] : ["listingLayoutTemplateId"])
      .go();
  }

  return NextResponse.json({ ok: true });
}
