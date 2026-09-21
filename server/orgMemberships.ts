import { randomUUID } from "node:crypto";

import { Organization, Member, User } from "@/lib/db/coreEntities";
import type { OrgRole } from "@/server/accessControl";

// Split out of server/orgDynamo.ts so this file has NO `next/headers` import — everything
// here is pure DynamoDB I/O with no dependency on a live Next.js request context, unlike
// ensureActiveOrganization/setActiveOrganizationCookie (still in orgDynamo.ts), which read/
// write the active-org cookie via next/headers' cookies() and so can only run inside an
// actual Next.js request. lambda/sol-chat/sessionAuth.ts resolves a session OUTSIDE any
// Next.js request context (a bare Lambda Function URL handler) and needs membershipsForUser/
// ensurePersonalWorkspace/ACTIVE_ORG_COOKIE without pulling in next/headers (which esbuild
// can't bundle standalone — see that file's own comment). orgDynamo.ts re-exports all three
// from here so every other existing call site keeps working unchanged.

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

// "Active organization": better-auth stored this on its own Session row, server-side.
// Auth.js's session shape has no equivalent slot without a custom callback coupling this
// app's org-switching to Auth.js's internals, so it's tracked independently as a plain
// httpOnly cookie instead — same "last org you were in" semantics, one fewer moving part.
export const ACTIVE_ORG_COOKIE = "plexo_active_org";

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

/**
 * Auto-provisions a brand-new user's default personal workspace — unlike createOrganization
 * (server/orgDynamo.ts, an explicit, user-initiated action with no uniqueness concern), this
 * runs from ensureActiveOrganization, which is called independently from many places in the
 * same request (e.g. app/dashboard/layout.tsx AND app/dashboard/page.tsx both call it for the
 * same render, with no data dependency between them forcing one to await the other). Two
 * such calls racing on a genuinely new user's very first request would both observe zero
 * memberships and both try to create a workspace, producing two orgs (and two owner Member
 * rows) for one user. A deterministic, per-user org id plus ElectroDB's .create()
 * attribute_not_exists condition closes that race the same way resolveCommerceWallet does
 * for a site's first sale: only one racing create() can win; the other observes
 * ConditionalCheckFailedException and just re-fetches what the winner created.
 */
export async function ensurePersonalWorkspace(userId: string, name: string): Promise<{ id: string; name: string }> {
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
