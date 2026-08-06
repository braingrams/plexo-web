import { NextRequest, NextResponse } from "next/server";
import { BlogCommentStatus } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { isValidUuid } from "@/server/slug";

const VALID_STATUSES = new Set(Object.values(BlogCommentStatus));

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; commentId: string }> },
): Promise<NextResponse> {
  const { templateId, commentId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(commentId)) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !VALID_STATUSES.has(body.status as BlogCommentStatus)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const comment = await prisma.blogComment.findFirst({
    where: { id: commentId, post: { templateId: resolved.context.templateId } },
    select: { id: true },
  });
  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  const updated = await prisma.blogComment.update({
    where: { id: commentId },
    data: { status: body.status as BlogCommentStatus },
  });

  return NextResponse.json({ comment: updated });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; commentId: string }> },
): Promise<NextResponse> {
  const { templateId, commentId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(commentId)) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["delete"] });
  if (permissionError) return permissionError;

  const comment = await prisma.blogComment.findFirst({
    where: { id: commentId, post: { templateId: resolved.context.templateId } },
    select: { id: true },
  });
  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  // Cascade (schema's onDelete: Cascade on parentId) also removes any replies to this comment.
  await prisma.blogComment.delete({ where: { id: commentId } });
  return NextResponse.json({ ok: true });
}
