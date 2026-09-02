import { NextRequest, NextResponse } from "next/server";
import { BlogAuthor, BlogPost } from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { isValidUuid } from "@/server/slugDynamo";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; authorId: string }> },
): Promise<NextResponse> {
  const { templateId, authorId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(authorId)) return NextResponse.json({ error: "Author not found." }, { status: 404 });

  const permissionError = requirePermission(resolved.context.role, { blog: ["delete"] });
  if (permissionError) return permissionError;

  const { data: authors } = await BlogAuthor.query.primary({ templateId: resolved.context.templateId }).go();
  const author = authors.find((a) => a.id === authorId);
  if (!author) return NextResponse.json({ error: "Author not found." }, { status: 404 });

  // Posts keep their content — they just lose the byline (Prisma: BlogPost.authorId
  // onDelete: SetNull). No DynamoDB equivalent, so every post referencing this author is
  // patched to clear it explicitly before the author itself is removed.
  const { data: posts } = await BlogPost.query.byStatus({ templateId: resolved.context.templateId }).go();
  const affected = posts.filter((p) => p.authorId === authorId);
  await Promise.all(affected.map((p) => BlogPost.patch({ templateId: resolved.context.templateId, slug: p.slug }).remove(["authorId"]).go()));

  await BlogAuthor.remove({ templateId: resolved.context.templateId, slug: author.slug }).go();
  return NextResponse.json({ ok: true });
}
