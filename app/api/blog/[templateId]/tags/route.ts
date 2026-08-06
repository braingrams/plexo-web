import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { slugify, avoidPageReservedSlug } from "@/server/slug";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const tags = await prisma.blogTag.findMany({ where: { templateId: resolved.context.templateId }, orderBy: { name: "asc" } });
  return NextResponse.json({ tags });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Tag name is required." }, { status: 400 });

  const baseSlug = avoidPageReservedSlug(slugify(name) || "tag", "tag");
  let slug = baseSlug;
  let suffix = 2;
  while (await prisma.blogTag.findFirst({ where: { templateId: resolved.context.templateId, slug }, select: { id: true } })) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const tag = await prisma.blogTag.create({ data: { templateId: resolved.context.templateId, name, slug } });
  return NextResponse.json({ tag }, { status: 201 });
}
