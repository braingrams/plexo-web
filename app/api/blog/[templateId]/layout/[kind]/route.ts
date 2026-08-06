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
 * A layout is just an ordinary LANDING_PAGE Template with isBlogLayout: true — created
 * once and reused (idempotent: calling this again while one's already attached just
 * returns it, so re-clicking "Design custom layout" never creates duplicates). It's
 * attached to BlogSite immediately, even blank — the public renderer (lib/pub/blogLayoutRender.ts)
 * only actually substitutes into it once it finds the required marker block, and falls
 * back to the default theme otherwise, so there's no broken/dead-end state to guard
 * against here: designing, saving, and going live all happen through the same normal
 * builder autosave, no separate "activate" step needed.
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

  const layoutTemplate = await prisma.template.create({
    data: {
      userId: resolved.context.userId,
      organizationId: resolved.context.organizationId,
      name: kind === "post" ? "Blog Post Layout" : "Blog Listing Layout",
      kind: TemplateKind.LANDING_PAGE,
      isBlogLayout: true,
      designJson: BLANK_TEMPLATE_SHELL,
      compiledHtml: "",
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
