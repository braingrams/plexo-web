import { NextRequest, NextResponse } from "next/server";
import { EntityItem } from "electrodb";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { Comment } from "@/lib/db/contentEntities";
import { triggerEvent, commentChannelName, isRealtimeConfigured } from "@/lib/realtime/pusher";

type CommentItem = EntityItem<typeof Comment>;

/**
 * Comment's only index is templateId-scoped (primary: templateId + createdAt#id, see
 * contentEntities.ts) — this route only ever receives the bare comment `id` (the client,
 * app/dashboard/templates/[id]/comments/useComments.ts, doesn't pass templateId on
 * PATCH/DELETE), so there's genuinely no indexed way to find "this comment" without one.
 * A full-table Scan filtered by id is the same documented tradeoff as
 * lib/siteTransferDynamo.ts's findTransferById — low-frequency (one comment edit/delete
 * at a time, not a listing endpoint) and there's no cheaper alternative today.
 */
async function findCommentById(id: string): Promise<CommentItem | null> {
  let cursor: string | null | undefined = undefined;
  do {
    const page: { data: CommentItem[]; cursor: string | null } = await Comment.scan
      .where((attr, op) => op.eq(attr.id, id))
      .go({ cursor });
    const found = page.data[0];
    if (found) return found;
    cursor = page.cursor;
  } while (cursor);
  return null;
}

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
  const existing = await findCommentById(id);
  if (!existing || existing.organizationId !== resolved.organizationId || existing.deletedAt) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }

  const patch = (await request.json().catch(() => ({}))) as PatchBody;
  const updates: { body?: string; editedAt?: string; resolvedAt?: string; resolvedById?: string } = {};
  const removals: ("resolvedAt" | "resolvedById")[] = [];

  if (patch.body !== undefined) {
    if (existing.authorId !== resolved.userId) {
      return NextResponse.json({ error: "You can only edit your own comments." }, { status: 403 });
    }
    const trimmed = patch.body.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Comment body cannot be empty." }, { status: 400 });
    }
    updates.body = trimmed;
    updates.editedAt = new Date().toISOString();
  }

  if (patch.resolved !== undefined) {
    const permissionError = requirePermission(resolved.role, { comment: ["resolve"] });
    if (permissionError) return permissionError;
    if (patch.resolved) {
      updates.resolvedAt = new Date().toISOString();
      updates.resolvedById = resolved.userId;
    } else {
      removals.push("resolvedAt", "resolvedById");
    }
  }

  if (Object.keys(updates).length > 0 || removals.length > 0) {
    let patchBuilder = Comment.patch({ templateId: existing.templateId, createdAt: existing.createdAt, id: existing.id }).set(updates);
    if (removals.length > 0) {
      patchBuilder = patchBuilder.remove(removals);
    }
    await patchBuilder.go();
  }

  const updated = { ...existing, ...updates };
  if (removals.includes("resolvedAt")) updated.resolvedAt = undefined;
  if (removals.includes("resolvedById")) updated.resolvedById = undefined;

  if (isRealtimeConfigured()) {
    const eventType = patch.resolved !== undefined ? "comment:resolved" : "comment:updated";
    triggerEvent(commentChannelName(resolved.organizationId, existing.templateId), eventType, {
      id: updated.id,
      body: updated.body,
      resolved: updated.resolvedAt != null,
    }).catch((err) => console.error("[pusher] comment update failed:", err));
  }

  return NextResponse.json({
    comment: {
      id: updated.id,
      body: updated.body,
      resolved: updated.resolvedAt != null,
      edited: updated.editedAt != null,
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
  const existing = await findCommentById(id);
  if (!existing || existing.organizationId !== resolved.organizationId || existing.deletedAt) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }

  const canDeleteAny = resolved.role === "owner" || resolved.role === "admin";
  if (existing.authorId !== resolved.userId && !canDeleteAny) {
    return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });
  }

  // Soft delete — preserves thread integrity for any replies (see contentEntities.ts's
  // Comment.deletedAt comment) instead of cascading a whole reply chain away.
  await Comment.patch({ templateId: existing.templateId, createdAt: existing.createdAt, id: existing.id })
    .set({ deletedAt: new Date().toISOString(), body: "" })
    .go();

  if (isRealtimeConfigured()) {
    triggerEvent(commentChannelName(resolved.organizationId, existing.templateId), "comment:deleted", { id }).catch(
      (err) => console.error("[pusher] comment:deleted failed:", err)
    );
  }

  return NextResponse.json({ success: true });
}
