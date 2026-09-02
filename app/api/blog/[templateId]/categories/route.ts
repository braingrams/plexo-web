import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { BlogCategory } from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { slugify, avoidPageReservedSlug } from "@/server/slugDynamo";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { data: categories } = await BlogCategory.query.primary({ templateId: resolved.context.templateId }).go();
  categories.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ categories });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = requirePermission(resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string; parentId?: string | null };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Category name is required." }, { status: 400 });

  // No DB-level foreign key here (unlike Prisma's P2003) — validated explicitly instead.
  if (body.parentId) {
    const { data: siblings } = await BlogCategory.query.primary({ templateId: resolved.context.templateId }).go();
    if (!siblings.some((c) => c.id === body.parentId)) {
      return NextResponse.json({ error: "Parent category not found." }, { status: 400 });
    }
  }

  const baseSlug = avoidPageReservedSlug(slugify(name) || "category", "category");
  let slug = baseSlug;
  let suffix = 2;
  while ((await BlogCategory.get({ templateId: resolved.context.templateId, slug }).go()).data) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const id = randomUUID();
  await BlogCategory.create({
    id,
    templateId: resolved.context.templateId,
    name,
    slug,
    description: body.description?.trim() || undefined,
    parentId: body.parentId || undefined,
  }).go();
  const { data: category } = await BlogCategory.get({ templateId: resolved.context.templateId, slug }).go();

  return NextResponse.json({ category }, { status: 201 });
}
