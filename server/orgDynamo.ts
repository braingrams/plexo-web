import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

import type { EntityItem } from "electrodb";
import { Organization, Member, Invitation, User } from "@/lib/db/coreEntities";
import type { OrgRole } from "@/server/accessControl";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildInviteEmail } from "@/lib/mail/templates";
import { getOrgBrand } from "@/lib/subscription";

// DynamoDB-stack replacement for server/org.ts + everything better-auth's `organization`
// plugin used to do server-side (createOrganization, invite/accept/reject/cancel, member
// CRUD, "active organization" tracking). None of this existed as a plugin under Auth.js —
// see docs/auth-migration-design.md's "What Auth.js actually replaces vs. what stays
// ours" table. Genuinely new code, not a mechanical Prisma->ElectroDB port.
//
// "Active organization": better-auth stored this on its own Session row, server-side.
// Auth.js's session shape has no equivalent slot without a custom callback coupling this
// app's org-switching to Auth.js's internals, so it's tracked independently as a plain
// httpOnly cookie instead — same "last org you were in" semantics, one fewer moving part.
const ACTIVE_ORG_COOKIE = "plexo_active_org";
const INVITATION_TTL_DAYS = 7;

export type ActiveOrgResolution =
  | { status: "resolved"; organizationId: string; organizationName: string; role: OrgRole }
  | { status: "needs-choice"; organizations: { id: string; name: string; role: OrgRole }[] };

async function membershipsForUser(userId: string): Promise<{ organizationId: string; role: OrgRole; organization: { id: string; name: string } }[]> {
  const { data: memberships } = await Member.query.byUser({ userId }).go();
  const orgs = await Promise.all(
    memberships.map(async (m) => {
      const { data: org } = await Organization.get({ id: m.organizationId }).go();
      return org ? { organizationId: m.organizationId, role: m.role as OrgRole, organization: { id: org.id, name: org.name } } : null;
    }),
  );
  return orgs.filter((o): o is NonNullable<typeof o> => o !== null);
}

export async function ensureActiveOrganization(userId: string): Promise<ActiveOrgResolution> {
  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  const memberships = await membershipsForUser(userId);

  if (activeOrgId) {
    const active = memberships.find((m) => m.organizationId === activeOrgId);
    if (active) {
      return { status: "resolved", organizationId: active.organizationId, organizationName: active.organization.name, role: active.role };
    }
  }

  if (memberships.length === 0) {
    // Brand-new signup that predates (or slipped past) the equivalent backfill — give
    // them a personal workspace, same slug convention as the original org.ts.
    const { data: user } = await User.get({ id: userId }).go();
    const org = await createOrganization(userId, `${user?.name ?? "My"}'s Workspace`);
    return { status: "resolved", organizationId: org.id, organizationName: org.name, role: "owner" };
  }

  if (memberships.length === 1) {
    const only = memberships[0];
    // Server Components can't set cookies (Next.js restriction) — callers that land here
    // during a page render rely on setActiveOrganizationCookie being called from the
    // nearest Server Action / Route Handler in the request (e.g. the dashboard layout's
    // own action), not from here.
    return { status: "resolved", organizationId: only.organizationId, organizationName: only.organization.name, role: only.role };
  }

  return {
    status: "needs-choice",
    organizations: memberships.map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role })),
  };
}

// Callable only from a Server Action or Route Handler (Next.js's cookie-write restriction) —
// mirrors better-auth's auth.api.setActiveOrganization.
export async function setActiveOrganizationCookie(organizationId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function createOrganization(
  userId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  const slug = `ws-${userId.slice(0, 8)}-${Date.now().toString(36)}`;
  await Organization.create({ id, name, slug }).go();
  await Member.create({ id: randomUUID(), organizationId: id, userId, role: "owner" }).go();
  return { id, name };
}

export async function listMembers(organizationId: string): Promise<
  { id: string; userId: string; role: OrgRole; name: string; email: string }[]
> {
  const { data: members } = await Member.query.primary({ organizationId }).go();
  const users = await Promise.all(members.map((m) => User.get({ id: m.userId }).go()));
  return members.map((m, i) => {
    const user = users[i].data;
    return { id: m.userId, userId: m.userId, role: m.role as OrgRole, name: user?.name ?? "Unknown", email: user?.email ?? "" };
  });
}

export async function removeMember(organizationId: string, userId: string): Promise<void> {
  await Member.remove({ organizationId, userId }).go();
}

export async function updateMemberRole(organizationId: string, userId: string, role: OrgRole): Promise<void> {
  await Member.patch({ organizationId, userId }).set({ role }).go();
}

export type InvitationView = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: OrgRole;
  status: string;
  inviterEmail: string;
  createdAt: string;
};

export async function listPendingInvitations(organizationId: string): Promise<InvitationView[]> {
  const { data: invitations } = await Invitation.query
    .byOrg({ organizationId })
    .where((attr, op) => op.eq(attr.status, "pending"))
    .go();
  return Promise.all(invitations.map((inv) => hydrateInvitation(inv)));
}

async function hydrateInvitation(inv: EntityItem<typeof Invitation>): Promise<InvitationView> {
  const [{ data: org }, { data: inviter }] = await Promise.all([
    Organization.get({ id: inv.organizationId }).go(),
    User.get({ id: inv.inviterId }).go(),
  ]);
  return {
    id: inv.id,
    organizationId: inv.organizationId,
    organizationName: org?.name ?? "Unknown organization",
    email: inv.email,
    role: inv.role as OrgRole,
    status: inv.status ?? "pending",
    inviterEmail: inviter?.email ?? "",
    createdAt: inv.createdAt ?? new Date().toISOString(),
  };
}

export async function getInvitation(id: string): Promise<InvitationView | null> {
  const { data: inv } = await Invitation.get({ id }).go();
  if (!inv) return null;
  return hydrateInvitation(inv);
}

export async function createInvitation(
  organizationId: string,
  organizationName: string,
  email: string,
  role: OrgRole,
  inviterId: string,
  inviterName: string,
): Promise<InvitationView> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await Invitation.create({ id, organizationId, email, role, inviterId, expiresAt }).go();

  const brand = await getOrgBrand(organizationId);
  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  await sendMaildripEmail({
    to: email,
    subject: `${inviterName} invited you to join ${organizationName} on Plexo`,
    html: buildInviteEmail({
      inviterName,
      orgName: organizationName,
      role,
      acceptUrl: `${baseUrl}/accept-invite/${id}`,
      brand,
    }),
  });

  const { data: created } = await Invitation.get({ id }).go();
  if (!created) throw new Error(`Invitation ${id} vanished immediately after being created`);
  return hydrateInvitation(created);
}

export async function acceptInvitation(id: string, userId: string): Promise<{ organizationId: string } | null> {
  const { data: inv } = await Invitation.get({ id }).go();
  if (!inv || inv.status !== "pending") return null;
  if (new Date(inv.expiresAt).getTime() < Date.now()) return null;

  await Member.create({ id: randomUUID(), organizationId: inv.organizationId, userId, role: inv.role }).go();
  await Invitation.patch({ id }).set({ status: "accepted" }).go();
  return { organizationId: inv.organizationId };
}

export async function rejectInvitation(id: string): Promise<void> {
  await Invitation.patch({ id }).set({ status: "rejected" }).go();
}

export async function cancelInvitation(id: string): Promise<void> {
  await Invitation.patch({ id }).set({ status: "canceled" }).go();
}
