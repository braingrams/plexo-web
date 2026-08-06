import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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

  const categories = await prisma.blogCategory.findMany({
    where: { templateId: resolved.context.templateId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ categories });
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

  const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string; parentId?: string | null };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Category name is required." }, { status: 400 });

  const baseSlug = avoidPageReservedSlug(slugify(name) || "category", "category");
  let slug = baseSlug;
  let suffix = 2;
  while (
    await prisma.blogCategory.findFirst({ where: { templateId: resolved.context.templateId, slug }, select: { id: true } })
  ) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  try {
    const category = await prisma.blogCategory.create({
      data: {
        templateId: resolved.context.templateId,
        name,
        slug,
        description: body.description?.trim() || null,
        parentId: body.parentId || null,
      },
    });
    return NextResponse.json({ category }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json({ error: "Parent category not found." }, { status: 400 });
    }
    throw err;
  }
}
