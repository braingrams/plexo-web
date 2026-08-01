import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { triggerEvent, commentChannelName, isRealtimeConfigured } from "@/lib/realtime/pusher";

type PatchBody = { body?: string; resolved?: boolean };

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.comment.findFirst({
    where: { id, organizationId: resolved.organizationId },
  });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }

  const patch = (await request.json().catch(() => ({}))) as PatchBody;
  const data: { body?: string; editedAt?: Date; resolvedAt?: Date | null; resolvedById?: string | null } = {};

  if (patch.body !== undefined) {
    if (existing.authorId !== resolved.userId) {
      return NextResponse.json({ error: "You can only edit your own comments." }, { status: 403 });
    }
    const trimmed = patch.body.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Comment body cannot be empty." }, { status: 400 });
    }
    data.body = trimmed;
    data.editedAt = new Date();
  }

  if (patch.resolved !== undefined) {
    const permissionError = await requirePermission(request.headers, resolved.role, { comment: ["resolve"] });
    if (permissionError) return permissionError;
    data.resolvedAt = patch.resolved ? new Date() : null;
    data.resolvedById = patch.resolved ? resolved.userId : null;
  }

  const updated = await prisma.comment.update({
    where: { id },
    data,
    include: { author: { select: { id: true, name: true, image: true } } },
  });

  if (isRealtimeConfigured()) {
    const eventType = patch.resolved !== undefined ? "comment:resolved" : "comment:updated";
    triggerEvent(commentChannelName(resolved.organizationId, existing.templateId), eventType, {
      id: updated.id,
      body: updated.body,
      resolved: updated.resolvedAt !== null,
    }).catch((err) => console.error("[pusher] comment update failed:", err));
  }

  return NextResponse.json({
    comment: {
      id: updated.id,
      body: updated.body,
      resolved: updated.resolvedAt !== null,
      edited: updated.editedAt !== null,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.comment.findFirst({
    where: { id, organizationId: resolved.organizationId },
  });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }

  const canDeleteAny = resolved.role === "owner" || resolved.role === "admin";
  if (existing.authorId !== resolved.userId && !canDeleteAny) {
    return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });
  }

  // Soft delete — preserves thread integrity for any replies (see prisma/schema.prisma's
  // Comment.deletedAt comment) instead of cascading a whole reply chain away.
  await prisma.comment.update({
    where: { id },
    data: { deletedAt: new Date(), body: "" },
  });

  if (isRealtimeConfigured()) {
    triggerEvent(commentChannelName(resolved.organizationId, existing.templateId), "comment:deleted", { id }).catch(
      (err) => console.error("[pusher] comment:deleted failed:", err)
    );
  }

  return NextResponse.json({ success: true });
}
