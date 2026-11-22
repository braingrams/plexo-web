import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Invitation, Notification, NotificationPreferences, Organization, User } from "@/lib/db/coreEntities";
import { Template } from "@/lib/db/contentEntities";
import { listIncomingTransfers, listOutgoingTransfers } from "@/lib/siteTransferDynamo";
import { CommerceOrder } from "@/lib/db/commerceEntities";
import { formatMoney } from "@/lib/commerce/formatMoney";

export type AppNotification = {
  id: string;
  type: "TRANSFER_OFFERED" | "TRANSFER_ACCEPTED" | "ORDER_RECEIVED" | "COMMENT_REPLY" | "MENTION" | "SYSTEM";
  title: string;
  message: string;
  link: string;
  actionLabel?: string;
  read: boolean;
  createdAt: string;
  meta?: Record<string, unknown>;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId, organizationId } = resolved;
  const { data: user } = await User.get({ id: userId }).go().catch(() => ({ data: null }));
  const userEmail = (user?.email || "").toLowerCase();

  const [
    prefsResult,
    dbNotifsResult,
    incomingTransfers,
    outgoingTransfers,
    pendingInvitesResult,
  ] = await Promise.all([
    NotificationPreferences.get({ organizationId }).go().catch(() => ({ data: null })),
    Notification.query.primary({ userId }).go({ order: "desc" }).catch(() => ({ data: [] })),
    userEmail ? listIncomingTransfers(userEmail).catch(() => []) : [],
    organizationId ? listOutgoingTransfers(organizationId).catch(() => []) : [],
    userEmail
      ? Invitation.scan
          .where((attr, op) => op.eq(attr.email, userEmail) && op.eq(attr.status, "pending"))
          .go({ pages: "all" })
          .catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
  ]);

  const templateIds = Array.from(new Set([...incomingTransfers.map((t) => t.templateId), ...outgoingTransfers.map((t) => t.templateId)]));
  const templates = await Promise.all(
    templateIds.map((tid) => Template.get({ id: tid }).go().then((r) => r.data).catch(() => null)),
  );
  const templateMap = new Map(templates.filter(Boolean).map((t) => [t!.id, t!.name]));

  const senderUserIds = Array.from(new Set(incomingTransfers.map((t) => t.fromUserId)));
  const senders = await Promise.all(
    senderUserIds.map((uid) => User.get({ id: uid }).go().then((r) => r.data).catch(() => null)),
  );
  const senderMap = new Map(senders.filter(Boolean).map((u) => [u!.id, u!.email]));

  const notifications: AppNotification[] = [];

  // 1. Incoming site transfers (high priority actionable notifications)
  for (const t of incomingTransfers) {
    const siteName = templateMap.get(t.templateId) || "Website";
    const fromEmail = senderMap.get(t.fromUserId) || "Another user";
    notifications.push({
      id: `transfer-in-${t.id}`,
      type: "TRANSFER_OFFERED",
      title: "Someone wants to give you a site",
      message: `${fromEmail} wants to give you "${siteName}".`,
      link: "/dashboard/settings/moving",
      actionLabel: "Review & accept",
      read: false,
      createdAt: t.createdAt ?? new Date().toISOString(),
      meta: { transferId: t.id, siteName, fromEmail },
    });
  }

  // 2. Pending Workspace / Team Invitations
  const pendingInvites = pendingInvitesResult?.data ?? [];
  for (const inv of pendingInvites) {
    const [{ data: org }, { data: inviter }] = await Promise.all([
      Organization.get({ id: inv.organizationId }).go().catch(() => ({ data: null })),
      User.get({ id: inv.inviterId }).go().catch(() => ({ data: null })),
    ]);
    notifications.push({
      id: `workspace-invite-${inv.id}`,
      type: "MENTION",
      title: `Invitation to join ${org?.name || "a workspace"}`,
      message: `${inviter?.name || inviter?.email || "A team member"} invited you to join "${org?.name || "the workspace"}" as ${inv.role}.`,
      link: `/accept-invite/${inv.id}`,
      actionLabel: "Accept invite",
      read: false,
      createdAt: inv.createdAt ?? new Date().toISOString(),
      meta: { invitationId: inv.id, organizationId: inv.organizationId, role: inv.role },
    });
  }

  // 3. Outgoing transfers waiting for acceptance
  for (const t of outgoingTransfers) {
    const siteName = templateMap.get(t.templateId) || "Website";
    notifications.push({
      id: `transfer-out-${t.id}`,
      type: "TRANSFER_ACCEPTED",
      title: `Site offered: ${siteName}`,
      message: `Sent to ${t.toEmail}. Waiting for them to accept.`,
      link: "/dashboard/settings/moving",
      actionLabel: "View status",
      read: true,
      createdAt: t.createdAt ?? new Date().toISOString(),
      meta: { transferId: t.id, siteName, toEmail: t.toEmail },
    });
  }

  // 4. Stored database notifications (visual design comments, mentions, etc.)
  if (dbNotifsResult?.data) {
    for (const n of dbNotifsResult.data) {
      // Purge any corrupted or empty legacy rows from the database
      if ((!n.message || n.message.trim() === "") && (!n.title || n.title === "Notification") && !n.actorId && !n.templateId) {
        void Notification.delete({ userId, createdAt: n.createdAt, id: n.id }).go().catch(() => null);
        continue;
      }

      let title = n.title;
      let message = n.message || "";
      let link = n.link || "/dashboard";

      // If it's a visual design comment or mention with missing metadata, hydrate it
      if ((!title || title === "Notification") && (n.actorId || n.templateId)) {
        const [{ data: actor }, { data: site }] = await Promise.all([
          n.actorId ? User.get({ id: n.actorId }).go().catch(() => ({ data: null })) : Promise.resolve({ data: null }),
          n.templateId ? Template.get({ id: n.templateId }).go().catch(() => ({ data: null })) : Promise.resolve({ data: null }),
        ]);
        const authorName = actor?.name || "A collaborator";
        const siteName = site?.name || "your site design";
        title = n.type === "MENTION" ? `${authorName} mentioned you on "${siteName}"` : `${authorName} commented on "${siteName}"`;
        if (!message) message = "Added a comment to your visual design.";
        if (n.templateId) link = `/dashboard/sites/${n.templateId}?tab=pages`;
      }

      // If still without a valid message or title, skip
      if (!title || title === "Notification") {
        void Notification.delete({ userId, createdAt: n.createdAt, id: n.id }).go().catch(() => null);
        continue;
      }

      notifications.push({
        id: n.id,
        type: (n.type as AppNotification["type"]) || "SYSTEM",
        title,
        message,
        link,
        actionLabel: n.actionLabel || "View",
        read: Boolean(n.readAt),
        createdAt: n.createdAt,
      });
    }
  }

  // Sort newest first
  notifications.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const unreadCount = notifications.filter((n) => !n.read).length;

  const settings = {
    inAppNotifications: prefsResult?.data?.inAppNotifications ?? true,
    inAppSound: prefsResult?.data?.inAppSound ?? true,
    soundChoice: prefsResult?.data?.soundChoice ?? "chime",
  };

  return NextResponse.json({
    notifications: notifications.slice(0, 50),
    totalCount: notifications.length,
    unreadCount,
    settings,
  });
}

/** Mark notifications as read or update preferences */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId, organizationId } = resolved;
  const body = (await request.json().catch(() => ({}))) as {
    action?: "read" | "read_all" | "settings" | "delete";
    notificationId?: string;
    settings?: {
      inAppNotifications?: boolean;
      inAppSound?: boolean;
      soundChoice?: string;
    };
  };

  if (body.action === "delete" && body.notificationId) {
    if (!body.notificationId.startsWith("transfer-") && !body.notificationId.startsWith("workspace-invite-")) {
      const list = await Notification.query.primary({ userId }).go({ order: "desc" }).catch(() => ({ data: [] }));
      const match = list.data.find((n) => n.id === body.notificationId);
      if (match) {
        await Notification.delete({ userId, createdAt: match.createdAt, id: match.id }).go().catch(() => null);
      }
    }
    return NextResponse.json({ success: true });
  }

  if (body.action === "read_all") {
    const list = await Notification.query.primary({ userId }).go({ order: "desc" }).catch(() => ({ data: [] }));
    const now = new Date().toISOString();
    await Promise.all(
      list.data
        .filter((n) => !n.readAt)
        .map((n) => Notification.patch({ userId, createdAt: n.createdAt, id: n.id }).set({ readAt: now }).go().catch(() => null)),
    );
    return NextResponse.json({ success: true });
  }

  if (body.action === "read" && body.notificationId) {
    // If it's a dynamic prefix like transfer-*, client tracks read locally or ignores
    if (!body.notificationId.startsWith("transfer-")) {
      const list = await Notification.query.primary({ userId }).go().catch(() => ({ data: [] }));
      const match = list.data.find((n) => n.id === body.notificationId);
      if (match) {
        await Notification.patch({ userId, createdAt: match.createdAt, id: match.id }).set({ readAt: new Date().toISOString() }).go().catch(() => null);
      }
    }
    return NextResponse.json({ success: true });
  }

  if (body.action === "settings" && body.settings) {
    await NotificationPreferences.upsert({
      organizationId,
      id: organizationId,
      inAppNotifications: body.settings.inAppNotifications ?? true,
      inAppSound: body.settings.inAppSound ?? true,
      soundChoice: body.settings.soundChoice ?? "chime",
    }).go();
    return NextResponse.json({ success: true, settings: body.settings });
  }

  return NextResponse.json({ success: true });
}
