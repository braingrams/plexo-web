import { NextRequest, NextResponse } from "next/server";
import { BlogTag, BlogPostTag } from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { isValidUuid } from "@/server/slugDynamo";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; tagId: string }> },
): Promise<NextResponse> {
  const { templateId, tagId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(tagId)) return NextResponse.json({ error: "Tag not found." }, { status: 404 });

  const permissionError = requirePermission(resolved.context.role, { blog: ["delete"] });
  if (permissionError) return permissionError;

  const { data: tags } = await BlogTag.query.primary({ templateId: resolved.context.templateId }).go();
  const tag = tags.find((t) => t.id === tagId);
  if (!tag) return NextResponse.json({ error: "Tag not found." }, { status: 404 });

  // Postgres's onDelete: Cascade on BlogPostTag -> BlogTag has no DynamoDB equivalent —
  // clean up the join rows explicitly via byTag (GSI1) before removing the tag itself.
  const { data: links } = await BlogPostTag.query.byTag({ tagId }).go();
  await Promise.all(links.map((l) => BlogPostTag.remove({ templateId: l.templateId, postId: l.postId, tagId: l.tagId }).go()));

  await BlogTag.remove({ templateId: resolved.context.templateId, slug: tag.slug }).go();
  return NextResponse.json({ ok: true });
}
