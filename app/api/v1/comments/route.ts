import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { Template, Comment, CommentMention } from "@/lib/db/contentEntities";
import { User, Notification } from "@/lib/db/coreEntities";
import { parseMentionedUserIds, commentSnippet } from "@/lib/comments/mentions";
import { triggerEvent, commentChannelName, userChannelName, isRealtimeConfigured } from "@/lib/realtime/pusher";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildMentionEmail, buildCommentReplyEmail } from "@/lib/mail/templates";
import { isNotificationEnabled } from "@/lib/notificationPreferencesDynamo";
import { getOrgBrandDynamo as getOrgBrand } from "@/server/orgDynamo";
import { logEmailDelivery } from "@/lib/mail/logEmail";

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

function serializeComment(c: {
  id: string;
  parentId?: string;
  body: string;
  anchorNodeId?: string;
  anchorNodeType?: string;
  anchorX?: number;
  anchorY?: number;
  deviceView?: string;
  resolvedAt?: string;
  resolvedById?: string;
  editedAt?: string;
  deletedAt?: string;
  createdAt: string;
  authorId: string;
  author: { id: string; name: string; image?: string };
}) {
  return {
    id: c.id,
    parentId: c.parentId ?? null,
    body: c.deletedAt ? "" : c.body,
    anchorNodeId: c.anchorNodeId ?? null,
    anchorNodeType: c.anchorNodeType ?? null,
    anchorX: c.anchorX ?? null,
    anchorY: c.anchorY ?? null,
    deviceView: c.deviceView ?? null,
    resolved: c.resolvedAt != null,
    resolvedById: c.resolvedById ?? null,
    edited: c.editedAt != null,
    deleted: c.deletedAt != null,
    createdAt: c.createdAt,
    author: { id: c.author.id, name: c.author.name, image: c.author.image ?? null },
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templateId = new URL(request.url).searchParams.get("templateId");
  if (!templateId) {
    return NextResponse.json({ error: "Missing 'templateId' query parameter." }, { status: 400 });
  }

  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  // Comment's primary index (templateId + createdAt#id) is already ascending order by
  // default — matches the original's orderBy: { createdAt: "asc" }.
  const { data: comments } = await Comment.query
    .primary({ templateId })
    .where((attr, op) => op.eq(attr.organizationId, resolved.organizationId))
    .go({ pages: "all" });

  const authorIds = Array.from(new Set(comments.map((c) => c.authorId)));
  const authors = await Promise.all(authorIds.map((id) => User.get({ id }).go()));
  const authorById = new Map(authors.map((a, i) => [authorIds[i], a.data]));

  return NextResponse.json({
    comments: comments.map((c) =>
      serializeComment({
        ...c,
        author: authorById.get(c.authorId)
          ? { id: c.authorId, name: authorById.get(c.authorId)!.name ?? "Plexo User", image: authorById.get(c.authorId)!.image }
          : { id: c.authorId, name: "Unknown", image: undefined },
      }),
    ),
  });
}

type CreateCommentBody = {
  templateId?: string;
  body?: string;
  parentId?: string;
  anchorNodeId?: string;
  anchorNodeType?: "row" | "column" | "element";
  anchorX?: number;
  anchorY?: number;
  deviceView?: "desktop" | "tablet" | "mobile";
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { comment: ["create"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as CreateCommentBody;
  const trimmedBody = body.body?.trim();
  if (!body.templateId || !trimmedBody) {
    return NextResponse.json({ error: "Missing 'templateId' or 'body'." }, { status: 400 });
  }

  const { data: template } = await Template.get({ id: body.templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  let parent: { id: string; authorId: string } | null = null;
  if (body.parentId) {
    // Comment has no bare-id index (primary key is templateId + createdAt#id) — the
    // parent lookup is still a real indexed query though, not a scan, since we already
    // know the template's partition; find-by-id is just an in-memory filter over that
    // one partition's (small) comment thread.
    const { data: threadComments } = await Comment.query.primary({ templateId: template.id }).go({ pages: "all" });
    const found = threadComments.find((c) => c.id === body.parentId);
    if (!found) {
      return NextResponse.json({ error: "Parent comment not found." }, { status: 404 });
    }
    parent = { id: found.id, authorId: found.authorId };
  }

  const commentId = crypto.randomUUID();
  await Comment.create({
    id: commentId,
    organizationId: resolved.organizationId,
    templateId: template.id,
    authorId: resolved.userId,
    parentId: body.parentId,
    body: trimmedBody,
    anchorNodeId: body.anchorNodeId,
    anchorNodeType: body.anchorNodeType,
    anchorX: body.anchorX,
    anchorY: body.anchorY,
    deviceView: body.deviceView,
  }).go();
  // Comment.get needs the full primary key (templateId + createdAt + id), and createdAt
  // is server-generated at create time (not known ahead of it) — re-derive it from a
  // fresh query of the partition instead of a direct .get().
  const { data: threadAfterCreate } = await Comment.query.primary({ templateId: template.id }).go({ pages: "all" });
  const created = threadAfterCreate.find((c) => c.id === commentId);
  if (!created) {
    return NextResponse.json({ error: "Failed to create comment." }, { status: 500 });
  }

  const { data: author } = await User.get({ id: resolved.userId }).go();
  const authorInfo = { id: resolved.userId, name: author?.name ?? "Plexo User", image: author?.image, email: author?.email };

  // Recipients: everyone @mentioned, plus (for a reply) the parent comment's author —
  // excluding the actor themselves either way, and de-duplicated so a mentioned parent
  // author only gets one notification, not two.
  const mentionedUserIds = parseMentionedUserIds(trimmedBody).filter((id) => id !== resolved.userId);
  const replyRecipientId = parent && parent.authorId !== resolved.userId ? parent.authorId : null;

  if (mentionedUserIds.length > 0) {
    await Promise.all(
      mentionedUserIds.map(async (userId) => {
        try {
          await CommentMention.create({ id: crypto.randomUUID(), commentId: created.id, userId }).go();
        } catch (err) {
          if (!isConditionalCheckFailure(err)) throw err; // duplicate mention — same effect as skipDuplicates: true
        }
      }),
    );
  }

  const mentionRecipients = mentionedUserIds;
  const replyOnlyRecipients = replyRecipientId && !mentionedUserIds.includes(replyRecipientId) ? [replyRecipientId] : [];

  const notificationTargets = [
    ...mentionRecipients.map((userId) => ({ userId, type: "MENTION" as const })),
    ...replyOnlyRecipients.map((userId) => ({ userId, type: "COMMENT_REPLY" as const })),
  ];

  if (notificationTargets.length > 0) {
    await Promise.all(
      notificationTargets.map((t) =>
        Notification.create({
          id: crypto.randomUUID(),
          organizationId: resolved.organizationId,
          userId: t.userId,
          type: t.type,
          actorId: resolved.userId,
          commentId: created.id,
          templateId: template.id,
        }).go(),
      ),
    );
  }

  const serialized = serializeComment({ ...created, author: authorInfo });

  // Realtime + email are best-effort side effects — never fail the comment creation itself.
  if (isRealtimeConfigured()) {
    triggerEvent(commentChannelName(resolved.organizationId, template.id), "comment:new", serialized).catch(
      (err) => console.error("[pusher] comment:new failed:", err)
    );
    for (const target of notificationTargets) {
      triggerEvent(userChannelName(target.userId), "notification:new", { type: target.type }).catch((err) =>
        console.error("[pusher] notification:new failed:", err)
      );
    }
  }

  if (notificationTargets.length > 0) {
    const recipients = await Promise.all(notificationTargets.map((t) => User.get({ id: t.userId }).go()));
    const emailByUserId = new Map(
      recipients.map((r, i) => [notificationTargets[i].userId, r.data?.email]).filter((e): e is [string, string] => !!e[1]),
    );
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const deepLinkUrl = `${baseUrl}/dashboard/templates/${template.id}?comment=${created.id}`;
    const snippet = commentSnippet(trimmedBody);
    const brand = await getOrgBrand(resolved.organizationId);

    const mentionsEnabled = await isNotificationEnabled(resolved.organizationId, "commentMentions");

    for (const target of notificationTargets) {
      if (target.type === "MENTION" && !mentionsEnabled) continue;
      const to = emailByUserId.get(target.userId);
      if (!to) continue;
      const html =
        target.type === "MENTION"
          ? buildMentionEmail({ mentionerName: authorInfo.name, templateName: template.name, commentSnippet: snippet, deepLinkUrl, brand })
          : buildCommentReplyEmail({ replierName: authorInfo.name, templateName: template.name, commentSnippet: snippet, deepLinkUrl, brand });
      const subject = target.type === "MENTION" ? `${authorInfo.name} mentioned you on Plexo` : `${authorInfo.name} replied on Plexo`;
      const context = target.type === "MENTION" ? "comment_mention_notification" : "comment_reply_notification";
      sendMaildripEmail({ to, subject, html })
        .then(() => {
          logEmailDelivery({ kind: "maildrip", to, subject, status: "sent", context, organizationId: resolved.organizationId, templateId: template.id });
        })
        .catch((err) => {
          console.error("[mail] comment notification failed:", err);
          logEmailDelivery({
            kind: "maildrip", to, subject, status: "failed",
            errorMessage: err instanceof Error ? err.message : String(err),
            context, organizationId: resolved.organizationId, templateId: template.id,
          });
        });
    }
  }

  return NextResponse.json({ comment: serialized }, { status: 201 });
}
