import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { parseMentionedUserIds, commentSnippet } from "@/lib/comments/mentions";
import { triggerEvent, commentChannelName, userChannelName, isRealtimeConfigured } from "@/lib/realtime/pusher";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildMentionEmail, buildCommentReplyEmail } from "@/lib/mail/templates";
import { isNotificationEnabled } from "@/lib/notificationPreferences";
import { getOrgBrand } from "@/lib/subscription";

function serializeComment(c: {
  id: string;
  parentId: string | null;
  body: string;
  anchorNodeId: string | null;
  anchorNodeType: string | null;
  anchorX: number | null;
  anchorY: number | null;
  deviceView: string | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  authorId: string;
  author: { id: string; name: string; image: string | null };
}) {
  return {
    id: c.id,
    parentId: c.parentId,
    body: c.deletedAt ? "" : c.body,
    anchorNodeId: c.anchorNodeId,
    anchorNodeType: c.anchorNodeType,
    anchorX: c.anchorX,
    anchorY: c.anchorY,
    deviceView: c.deviceView,
    resolved: c.resolvedAt !== null,
    resolvedById: c.resolvedById,
    edited: c.editedAt !== null,
    deleted: c.deletedAt !== null,
    createdAt: c.createdAt.toISOString(),
    author: { id: c.author.id, name: c.author.name, image: c.author.image },
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

  const template = await prisma.template.findFirst({
    where: { id: templateId, organizationId: resolved.organizationId },
    select: { id: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const comments = await prisma.comment.findMany({
    where: { templateId, organizationId: resolved.organizationId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, image: true } } },
  });

  return NextResponse.json({ comments: comments.map(serializeComment) });
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

  const permissionError = await requirePermission(request.headers, resolved.role, { comment: ["create"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as CreateCommentBody;
  const trimmedBody = body.body?.trim();
  if (!body.templateId || !trimmedBody) {
    return NextResponse.json({ error: "Missing 'templateId' or 'body'." }, { status: 400 });
  }

  const template = await prisma.template.findFirst({
    where: { id: body.templateId, organizationId: resolved.organizationId },
    select: { id: true, name: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  let parent: { id: string; authorId: string } | null = null;
  if (body.parentId) {
    parent = await prisma.comment.findFirst({
      where: { id: body.parentId, templateId: template.id },
      select: { id: true, authorId: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "Parent comment not found." }, { status: 404 });
    }
  }

  const comment = await prisma.comment.create({
    data: {
      organizationId: resolved.organizationId,
      templateId: template.id,
      authorId: resolved.userId,
      parentId: body.parentId ?? null,
      body: trimmedBody,
      anchorNodeId: body.anchorNodeId ?? null,
      anchorNodeType: body.anchorNodeType ?? null,
      anchorX: body.anchorX ?? null,
      anchorY: body.anchorY ?? null,
      deviceView: body.deviceView ?? null,
    },
    include: { author: { select: { id: true, name: true, image: true, email: true } } },
  });

  // Recipients: everyone @mentioned, plus (for a reply) the parent comment's author —
  // excluding the actor themselves either way, and de-duplicated so a mentioned parent
  // author only gets one notification, not two.
  const mentionedUserIds = parseMentionedUserIds(trimmedBody).filter((id) => id !== resolved.userId);
  const replyRecipientId = parent && parent.authorId !== resolved.userId ? parent.authorId : null;

  if (mentionedUserIds.length > 0) {
    await prisma.commentMention.createMany({
      data: mentionedUserIds.map((userId) => ({ commentId: comment.id, userId })),
      skipDuplicates: true,
    });
  }

  const mentionRecipients = mentionedUserIds;
  const replyOnlyRecipients = replyRecipientId && !mentionedUserIds.includes(replyRecipientId) ? [replyRecipientId] : [];

  const notificationTargets = [
    ...mentionRecipients.map((userId) => ({ userId, type: "MENTION" as const })),
    ...replyOnlyRecipients.map((userId) => ({ userId, type: "COMMENT_REPLY" as const })),
  ];

  if (notificationTargets.length > 0) {
    await prisma.notification.createMany({
      data: notificationTargets.map((t) => ({
        organizationId: resolved.organizationId,
        userId: t.userId,
        type: t.type,
        actorId: resolved.userId,
        commentId: comment.id,
        templateId: template.id,
      })),
    });
  }

  // Realtime + email are best-effort side effects — never fail the comment creation itself.
  if (isRealtimeConfigured()) {
    triggerEvent(commentChannelName(resolved.organizationId, template.id), "comment:new", serializeComment(comment)).catch(
      (err) => console.error("[pusher] comment:new failed:", err)
    );
    for (const target of notificationTargets) {
      triggerEvent(userChannelName(target.userId), "notification:new", { type: target.type }).catch((err) =>
        console.error("[pusher] notification:new failed:", err)
      );
    }
  }

  if (notificationTargets.length > 0) {
    const recipients = await prisma.user.findMany({
      where: { id: { in: notificationTargets.map((t) => t.userId) } },
      select: { id: true, email: true },
    });
    const emailByUserId = new Map(recipients.map((r) => [r.id, r.email]));
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const deepLinkUrl = `${baseUrl}/dashboard/templates/${template.id}?comment=${comment.id}`;
    const snippet = commentSnippet(trimmedBody);
    const brand = await getOrgBrand(resolved.organizationId);

    const mentionsEnabled = await isNotificationEnabled(resolved.organizationId, "commentMentions");

    for (const target of notificationTargets) {
      if (target.type === "MENTION" && !mentionsEnabled) continue;
      const to = emailByUserId.get(target.userId);
      if (!to) continue;
      const html =
        target.type === "MENTION"
          ? buildMentionEmail({ mentionerName: comment.author.name, templateName: template.name, commentSnippet: snippet, deepLinkUrl, brand })
          : buildCommentReplyEmail({ replierName: comment.author.name, templateName: template.name, commentSnippet: snippet, deepLinkUrl, brand });
      sendMaildripEmail({
        to,
        subject: target.type === "MENTION" ? `${comment.author.name} mentioned you on Plexo` : `${comment.author.name} replied on Plexo`,
        html,
      }).catch((err) => console.error("[mail] comment notification failed:", err));
    }
  }

  return NextResponse.json({ comment: serializeComment(comment) }, { status: 201 });
}
