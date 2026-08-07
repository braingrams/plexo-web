import { NextRequest, NextResponse } from "next/server";
import { TemplateKind } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";

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

  const sites = await prisma.blogSite.findMany({
    where: {
      template: { organizationId: resolved.context.organizationId },
      templateId: { not: resolved.context.templateId },
      ...(kind === "post" ? { postLayoutTemplateId: { not: null } } : { listingLayoutTemplateId: { not: null } }),
    },
    select: {
      template: { select: { name: true } },
      postLayoutTemplate: kind === "post" ? { select: { id: true, name: true, updatedAt: true } } : false,
      listingLayoutTemplate: kind === "listing" ? { select: { id: true, name: true, updatedAt: true } } : false,
    },
  });

  const candidates = sites
    .map((s) => {
      const layout = kind === "post" ? s.postLayoutTemplate : s.listingLayoutTemplate;
      if (!layout) return null;
      return { layoutTemplateId: layout.id, layoutName: layout.name, siteName: s.template.name, updatedAt: layout.updatedAt };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

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

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const site = await prisma.blogSite.findUnique({ where: { templateId: resolved.context.templateId } });
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
    const sourceSite = await prisma.blogSite.findFirst({
      where: {
        template: { organizationId: resolved.context.organizationId },
        ...(kind === "post" ? { postLayoutTemplateId: sourceLayoutTemplateId } : { listingLayoutTemplateId: sourceLayoutTemplateId }),
      },
      select: {
        postLayoutTemplate: kind === "post" ? { select: { name: true, designJson: true, compiledHtml: true } } : false,
        listingLayoutTemplate: kind === "listing" ? { select: { name: true, designJson: true, compiledHtml: true } } : false,
      },
    });
    const source = kind === "post" ? sourceSite?.postLayoutTemplate : sourceSite?.listingLayoutTemplate;
    if (!source) {
      return NextResponse.json({ error: "That layout is no longer available to reuse — it may have been detached from its site." }, { status: 400 });
    }
    name = source.name;
    designJson = source.designJson as object;
    compiledHtml = source.compiledHtml;
  }

  const layoutTemplate = await prisma.template.create({
    data: {
      userId: resolved.context.userId,
      organizationId: resolved.context.organizationId,
      name,
      kind: TemplateKind.LANDING_PAGE,
      isBlogLayout: true,
      designJson,
      compiledHtml,
    },
    select: { id: true },
  });

  await prisma.blogSite.upsert({
    where: { templateId: resolved.context.templateId },
    create: {
      templateId: resolved.context.templateId,
      ...(kind === "post" ? { postLayoutTemplateId: layoutTemplate.id } : { listingLayoutTemplateId: layoutTemplate.id }),
    },
    update: kind === "post" ? { postLayoutTemplateId: layoutTemplate.id } : { listingLayoutTemplateId: layoutTemplate.id },
  });

  return NextResponse.json({ layoutTemplateId: layoutTemplate.id }, { status: 201 });
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

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  await prisma.blogSite.updateMany({
    where: { templateId: resolved.context.templateId },
    data: kind === "post" ? { postLayoutTemplateId: null } : { listingLayoutTemplateId: null },
  });

  return NextResponse.json({ ok: true });
}
