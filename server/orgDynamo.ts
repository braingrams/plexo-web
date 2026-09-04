import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

import type { EntityItem } from "electrodb";
import { Organization, Member, Invitation, User } from "@/lib/db/coreEntities";
import type { OrgRole } from "@/server/accessControl";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildInviteEmail } from "@/lib/mail/templates";
import { canWhiteLabel } from "@/lib/subscription";
import { logEmailDelivery } from "@/lib/mail/logEmail";

// DynamoDB-native replacement for lib/subscription.ts's getOrgBrand/getOrganizationOwnerPlan
// (both Prisma-backed) — can't reuse those directly here: an organization created through
// this file's createOrganization() only exists in DynamoDB, so a Prisma query for it would
// silently find nothing and always fall back to "no branding" even for an org that has it
// configured. canWhiteLabel() itself is pure (a plan-tier lookup table, no I/O) so it's
// still shared.
export async function getOrganizationOwnerPlanDynamo(organizationId: string): Promise<string> {
  const { data: owner } = await Member.query.primary({ organizationId }).where((attr, op) => op.eq(attr.role, "owner")).go();
  const ownerUserId = owner[0]?.userId;
  if (!ownerUserId) return "FREE";
  const { data: ownerUser } = await User.get({ id: ownerUserId }).go();
  return ownerUser?.subscriptionPlan ?? "FREE";
}

export async function getOrgBrandDynamo(organizationId: string): Promise<{ name: string; logoUrl?: string; color?: string } | undefined> {
  const { data: org } = await Organization.get({ id: organizationId }).go();
  if (!org) return undefined;
  const plan = await getOrganizationOwnerPlanDynamo(organizationId);
  if (!canWhiteLabel(plan) || !org.whiteLabelEnabled) return undefined;
  return { name: org.name, logoUrl: org.logo, color: org.brandColor };
}

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

export async function membershipsForUser(userId: string): Promise<{ organizationId: string; role: OrgRole; organization: { id: string; name: string } }[]> {
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
    const org = await ensurePersonalWorkspace(userId, `${user?.name ?? "My"}'s Workspace`);
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

/**
 * Auto-provisions a brand-new user's default personal workspace — unlike createOrganization
 * below (an explicit, user-initiated action with no uniqueness concern), this runs from
 * ensureActiveOrganization, which is called independently from many places in the same
 * request (e.g. app/dashboard/layout.tsx AND app/dashboard/page.tsx both call it for the
 * same render, with no data dependency between them forcing one to await the other). Two
 * such calls racing on a genuinely new user's very first request would both observe zero
 * memberships and both try to create a workspace, producing two orgs (and two owner Member
 * rows) for one user. A deterministic, per-user org id plus ElectroDB's .create()
 * attribute_not_exists condition closes that race the same way resolveCommerceWallet does
 * for a site's first sale: only one racing create() can win; the other observes
 * ConditionalCheckFailedException and just re-fetches what the winner created.
 */
async function ensurePersonalWorkspace(userId: string, name: string): Promise<{ id: string; name: string }> {
  const id = `personal-${userId}`;
  const slug = `ws-${userId.slice(0, 8)}-${Date.now().toString(36)}`;

  // Each create is independently idempotent (conditioned on its own primary key —
  // Organization's is `id`, Member's is the {organizationId, userId} composite) so this
  // also self-heals the rare case where a previous call created the org but failed before
  // creating its Member row (e.g. a transient error, not a race) — a plain "does the org
  // already exist" short-circuit would have skipped repairing that.
  try {
    await Organization.create({ id, name, slug }).go();
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err; // lost the create race — another concurrent call already provisioned this org
  }
  try {
    await Member.create({ id: randomUUID(), organizationId: id, userId, role: "owner" }).go();
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err; // membership already exists
  }

  const { data: org } = await Organization.get({ id }).go();
  if (!org) throw new Error(`Failed to provision personal workspace for user ${userId}`);
  return { id: org.id, name: org.name };
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
  { id: string; userId: string; role: OrgRole; scopedTemplateIds: string[]; name: string; email: string }[]
> {
  const { data: members } = await Member.query.primary({ organizationId }).go();
  const users = await Promise.all(members.map((m) => User.get({ id: m.userId }).go()));
  return members.map((m, i) => {
    const user = users[i].data;
    return {
      id: m.userId,
      userId: m.userId,
      role: m.role as OrgRole,
      scopedTemplateIds: m.scopedTemplateIds ?? [],
      name: user?.name ?? "Unknown",
      email: user?.email ?? "",
    };
  });
}

export async function removeMember(organizationId: string, userId: string): Promise<void> {
  await Member.remove({ organizationId, userId }).go();
}

// Granular-permissions v1 — scopedTemplateIds is only ever meaningful for role "editor"
// (see lib/db/coreEntities.ts's Member.scopedTemplateIds doc comment); it's cleared
// outright for every other role so a member later re-promoted to editor never silently
// inherits a stale scope list from a previous stint, and so owner/admin can never be
// scopable in this v1 no matter what a caller passes.
export async function updateMemberRole(
  organizationId: string,
  userId: string,
  role: OrgRole,
  scopedTemplateIds?: string[],
): Promise<void> {
  const nextScopedTemplateIds = role === "editor" ? (scopedTemplateIds ?? []) : [];
  await Member.patch({ organizationId, userId }).set({ role, scopedTemplateIds: nextScopedTemplateIds }).go();
}

export type InvitationView = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: OrgRole;
  scopedTemplateIds: string[];
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
    scopedTemplateIds: inv.scopedTemplateIds ?? [],
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
  scopedTemplateIds?: string[],
): Promise<InvitationView> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Same "only editor is scopable" rule as updateMemberRole — see that function's comment.
  const nextScopedTemplateIds = role === "editor" ? (scopedTemplateIds ?? []) : [];
  await Invitation.create({ id, organizationId, email, role, scopedTemplateIds: nextScopedTemplateIds, inviterId, expiresAt }).go();

  const brand = await getOrgBrandDynamo(organizationId);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const inviteSubject = `${inviterName} invited you to join ${organizationName} on Plexo`;
  // The invitation row above is already committed — a MailDrip outage here must not crash
  // invite creation (previously it did: this call had no try/catch at all). Same
  // swallow-and-log discipline as every other call site in this migration; the invite is
  // still real and reachable via the dashboard's "resend" action even if the email failed.
  try {
    await sendMaildripEmail({
      to: email,
      subject: inviteSubject,
      html: buildInviteEmail({
        inviterName,
        orgName: organizationName,
        role,
        acceptUrl: `${baseUrl}/accept-invite/${id}`,
        brand,
      }),
    });
    logEmailDelivery({ kind: "maildrip", to: email, subject: inviteSubject, status: "sent", context: "invitation", organizationId });
  } catch (err) {
    console.error("Failed to send invitation email:", err);
    logEmailDelivery({
      kind: "maildrip", to: email, subject: inviteSubject, status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context: "invitation", organizationId,
    });
  }

  const { data: created } = await Invitation.get({ id }).go();
  if (!created) throw new Error(`Invitation ${id} vanished immediately after being created`);
  return hydrateInvitation(created);
}

export async function acceptInvitation(id: string, userId: string): Promise<{ organizationId: string } | null> {
  const { data: inv } = await Invitation.get({ id }).go();
  if (!inv || inv.status !== "pending") return null;
  if (new Date(inv.expiresAt).getTime() < Date.now()) return null;

  await Member.create({
    id: randomUUID(),
    organizationId: inv.organizationId,
    userId,
    role: inv.role,
    scopedTemplateIds: inv.scopedTemplateIds ?? [],
  }).go();
  await Invitation.patch({ id }).set({ status: "accepted" }).go();
  return { organizationId: inv.organizationId };
}

export async function rejectInvitation(id: string): Promise<void> {
  await Invitation.patch({ id }).set({ status: "rejected" }).go();
}

export async function cancelInvitation(id: string): Promise<void> {
  await Invitation.patch({ id }).set({ status: "canceled" }).go();
}
