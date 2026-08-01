import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";

/** Backs the dashboard header's notification bell — mention/reply/resolve/invite events. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notifications = await prisma.notification.findMany({
    where: { organizationId: resolved.organizationId, userId: resolved.userId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      actor: { select: { id: true, name: true, image: true } },
    },
  });

  const unreadCount = await prisma.notification.count({
    where: { organizationId: resolved.organizationId, userId: resolved.userId, readAt: null },
  });

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      actorName: n.actor?.name ?? null,
      actorImage: n.actor?.image ?? null,
      commentId: n.commentId,
      templateId: n.templateId,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount,
  });
}

type PatchBody = { id?: string; markAllRead?: boolean };

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchBody;

  if (body.markAllRead) {
    await prisma.notification.updateMany({
      where: { organizationId: resolved.organizationId, userId: resolved.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ success: true });
  }

  if (body.id) {
    await prisma.notification.updateMany({
      where: { id: body.id, organizationId: resolved.organizationId, userId: resolved.userId },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Missing 'id' or 'markAllRead'." }, { status: 400 });
}
