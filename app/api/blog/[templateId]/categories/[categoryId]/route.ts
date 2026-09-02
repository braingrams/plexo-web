import { NextRequest, NextResponse } from "next/server";
import { BlogCategory, BlogPostCategory } from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { isValidUuid } from "@/server/slugDynamo";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; categoryId: string }> },
): Promise<NextResponse> {
  const { templateId, categoryId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(categoryId)) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  const permissionError = requirePermission(resolved.context.role, { blog: ["delete"] });
  if (permissionError) return permissionError;

  // BlogCategory's primary key is (templateId, slug), not id — find it by scanning the
  // template's category list, same pattern used throughout this migration for entities
  // whose real key isn't the id field callers pass around.
  const { data: categories } = await BlogCategory.query.primary({ templateId: resolved.context.templateId }).go();
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  // Postgres's onDelete: Cascade on BlogPostCategory -> BlogCategory has no DynamoDB
  // equivalent — clean up the join rows explicitly via byCategory (GSI1) before removing
  // the category itself, so a post never ends up pointing at a deleted category.
  const { data: links } = await BlogPostCategory.query.byCategory({ categoryId }).go();
  await Promise.all(links.map((l) => BlogPostCategory.remove({ templateId: l.templateId, postId: l.postId, categoryId: l.categoryId }).go()));

  await BlogCategory.remove({ templateId: resolved.context.templateId, slug: category.slug }).go();
  return NextResponse.json({ ok: true });
}
