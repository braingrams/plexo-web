import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { docClient } from "@/lib/db/client";
import { SolConversation, SolMessage } from "@/lib/db/solEntities";

/** Same userId-scoped scan-and-find-by-id pattern as
 * lib/db/solConversationActivity.ts's bumpConversationActivity and the export route —
 * SolConversation has no by-id index (its primary key embeds `updatedAt`, see
 * solEntities.ts), so there is no cheaper direct lookup available. */
async function loadOwnedConversation(userId: string, organizationId: string, conversationId: string) {
  const { data: conversations } = await SolConversation.query.primary({ userId }).go({ pages: "all" });
  const conversation = conversations.find((c) => c.id === conversationId);
  if (!conversation || conversation.organizationId !== organizationId) return null;
  return conversation;
}

/**
 * PATCH /api/v1/sol/conversations/:id
 *
 * Renames (`title`) and/or archives/reactivates (`status`) a conversation. Both fields go
 * through the same delete-old-item/put-new-item transaction lib/db/solConversationActivity.ts
 * uses for the identical reason: `updatedAt` is embedded in SolConversation's own primary
 * sort key, so a plain `.patch()` can't safely touch it (see that file's own long comment
 * on why — verified against ElectroDB's own source, not assumed). A rename/archive is a
 * user-visible edit, so it bumps `updatedAt` too (moves the conversation to the top of the
 * "most recent" list), same as sending a new message would.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: conversationId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { title?: string; status?: string };

  if (body.status !== undefined && body.status !== "ACTIVE" && body.status !== "ARCHIVED") {
    return NextResponse.json({ error: 'status must be "ACTIVE" or "ARCHIVED".' }, { status: 400 });
  }
  if (body.title === undefined && body.status === undefined) {
    return NextResponse.json({ error: "Provide at least one of `title` or `status`." }, { status: 400 });
  }

  const existing = await loadOwnedConversation(resolved.userId, resolved.organizationId, conversationId);
  if (!existing) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const nextTitle = body.title !== undefined ? body.title.trim() || undefined : existing.title;
  const nextStatus = body.status ?? existing.status;

  const deleteParams = SolConversation.remove({ userId: existing.userId, updatedAt: existing.updatedAt, id: existing.id })
    .where((attr, op) => op.eq(attr.updatedAt, existing.updatedAt))
    .params();
  const putParams = SolConversation.create({
    id: existing.id,
    userId: existing.userId,
    organizationId: existing.organizationId,
    title: nextTitle,
    modelTier: existing.modelTier,
    status: nextStatus,
    lastMessageAt: existing.lastMessageAt,
    messageCount: existing.messageCount,
    createdAt: existing.createdAt,
    updatedAt: now,
  }).params();

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Delete: deleteParams as any },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Put: putParams as any },
        ],
      }),
    );
  } catch (err) {
    console.error("Failed to update SOL conversation:", err);
    return NextResponse.json({ error: "This conversation was just updated elsewhere — please retry." }, { status: 409 });
  }

  return NextResponse.json({
    conversation: {
      id: existing.id,
      title: nextTitle ?? null,
      modelTier: existing.modelTier,
      status: nextStatus,
      lastMessageAt: existing.lastMessageAt ?? null,
      messageCount: existing.messageCount ?? 0,
      createdAt: existing.createdAt,
      updatedAt: now,
    },
  });
}

/**
 * DELETE /api/v1/sol/conversations/:id
 *
 * Permanently deletes a conversation and its full transcript. SolMessage rows aren't
 * cascade-deleted by DynamoDB itself (no such thing for a plain key-value delete), so this
 * explicitly removes every message row too — otherwise they'd become permanently
 * unreachable orphans (SolMessage's only index is scoped to conversationId, and the
 * conversation id that anchored it would be gone).
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: conversationId } = await context.params;
  const existing = await loadOwnedConversation(resolved.userId, resolved.organizationId, conversationId);
  if (!existing) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const { data: messages } = await SolMessage.query.primary({ conversationId }).go({ pages: "all" });
  // DynamoDB BatchWrite caps at 25 items per call.
  for (let i = 0; i < messages.length; i += 25) {
    const batch = messages.slice(i, i + 25);
    await Promise.all(batch.map((m) => SolMessage.remove({ conversationId, createdAt: m.createdAt, id: m.id }).go()));
  }

  await SolConversation.remove({ userId: existing.userId, updatedAt: existing.updatedAt, id: existing.id }).go();

  return NextResponse.json({ success: true });
}
