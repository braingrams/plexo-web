import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { isValidUuid } from "@/server/slug";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; authorId: string }> },
): Promise<NextResponse> {
  const { templateId, authorId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(authorId)) return NextResponse.json({ error: "Author not found." }, { status: 404 });

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["delete"] });
  if (permissionError) return permissionError;

  const author = await prisma.blogAuthor.findFirst({ where: { id: authorId, templateId: resolved.context.templateId }, select: { id: true } });
  if (!author) return NextResponse.json({ error: "Author not found." }, { status: 404 });

  // Posts keep their content — they just lose the byline (BlogPost.authorId is
  // onDelete: SetNull), same as removing a category/tag from a post.
  await prisma.blogAuthor.delete({ where: { id: authorId } });
  return NextResponse.json({ ok: true });
}
