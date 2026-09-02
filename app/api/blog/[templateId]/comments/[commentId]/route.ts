import { NextRequest, NextResponse } from "next/server";
import { BlogComment } from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { findCommentById, getDescendantCommentIds } from "@/lib/blog/commentsDynamo";
import { isValidUuid } from "@/server/slugDynamo";

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "SPAM", "REJECTED"]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; commentId: string }> },
): Promise<NextResponse> {
  const { templateId, commentId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(commentId)) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  const permissionError = requirePermission(resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const comment = await findCommentById(resolved.context.templateId, commentId);
  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  // status is part of this entity's own sort key (see contentEntities.ts) — same
  // create-at-new-key + remove-old-key pattern savePostDynamo.ts uses for a slug rename.
  await BlogComment.create({ ...comment, status: body.status as "PENDING" | "APPROVED" | "SPAM" | "REJECTED" }).go();
  await BlogComment.remove({ postId: comment.postId, status: comment.status ?? "PENDING", createdAt: comment.createdAt ?? "", id: comment.id }).go();

  const newStatus = body.status as "PENDING" | "APPROVED" | "SPAM" | "REJECTED";
  const { data: updated } = await BlogComment.get({ postId: comment.postId, status: newStatus, createdAt: comment.createdAt ?? "", id: comment.id }).go();

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

  const permissionError = requirePermission(resolved.context.role, { blog: ["delete"] });
  if (permissionError) return permissionError;

  const comment = await findCommentById(resolved.context.templateId, commentId);
  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  // Cascade (Prisma schema's onDelete: Cascade on parentId) also removes any replies to
  // this comment — walked explicitly since DynamoDB has no equivalent.
  const replies = await getDescendantCommentIds(comment.postId, commentId);
  await Promise.all(
    [...replies, comment].map((c) =>
      BlogComment.remove({ postId: c.postId, status: c.status ?? "PENDING", createdAt: c.createdAt ?? "", id: c.id }).go(),
    ),
  );
  return NextResponse.json({ ok: true });
}
