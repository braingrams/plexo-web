import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { Notification, User } from "@/lib/db/coreEntities";

const FEED_LIMIT = 30;

/** Backs the dashboard header's notification bell — mention/reply/resolve/invite events. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Notification's primary index is userId-scoped (newest first via createdAt#id, see
  // coreEntities.ts) — a real indexed query, not a scan, but it has no compound index over
  // organizationId too, so the org check is applied in memory after reading this one
  // user's full partition (bounded by how many notifications a single user accumulates,
  // not by total row count across the table).
  const { data: allForUser } = await Notification.query.primary({ userId: resolved.userId }).go({ order: "desc", pages: "all" });
  const forOrg = allForUser.filter((n) => n.organizationId === resolved.organizationId);
  const notifications = forOrg.slice(0, FEED_LIMIT);
  const unreadCount = forOrg.filter((n) => !n.readAt).length;

  const actorIds = Array.from(new Set(notifications.map((n) => n.actorId).filter((id): id is string => !!id)));
  const actors = await Promise.all(actorIds.map((id) => User.get({ id }).go()));
  const actorById = new Map(actors.map((a, i) => [actorIds[i], a.data]));

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      actorName: n.actorId ? actorById.get(n.actorId)?.name ?? null : null,
      actorImage: n.actorId ? actorById.get(n.actorId)?.image ?? null : null,
      commentId: n.commentId ?? null,
      templateId: n.templateId ?? null,
      readAt: n.readAt ?? null,
      createdAt: n.createdAt,
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
  const readAt = new Date().toISOString();

  if (body.markAllRead) {
    const { data: allForUser } = await Notification.query.primary({ userId: resolved.userId }).go({ pages: "all" });
    const unread = allForUser.filter((n) => n.organizationId === resolved.organizationId && !n.readAt);
    await Promise.all(
      unread.map((n) => Notification.patch({ userId: n.userId, createdAt: n.createdAt, id: n.id }).set({ readAt }).go()),
    );
    return NextResponse.json({ success: true });
  }

  if (body.id) {
    const { data: allForUser } = await Notification.query.primary({ userId: resolved.userId }).go({ pages: "all" });
    const match = allForUser.find((n) => n.id === body.id && n.organizationId === resolved.organizationId);
    if (match) {
      await Notification.patch({ userId: match.userId, createdAt: match.createdAt, id: match.id }).set({ readAt }).go();
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Missing 'id' or 'markAllRead'." }, { status: 400 });
}
