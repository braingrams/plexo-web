import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "@better-auth/utils/password";

import { User } from "@/lib/db/coreEntities";
import { createUserWithEmailLock, EmailAlreadyInUseError } from "@/lib/db/coreOperations";
import { syncSignupToAlps } from "@/lib/alps";

/**
 * Turns an already signature-verified Charisol ID token's claims into a local Plexo user.
 * Kept out of server/authDynamo.ts so the matching rules are unit-testable without
 * constructing NextAuth. The caller MUST have verified the token (CognitoJwtVerifier) first —
 * nothing here re-checks signature/issuer/audience, only what the claims say about the email.
 */

export type CharisolClaims = Record<string, unknown>;

export interface CharisolLocalUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

/** A random, never-disclosed password hash: the account has no password anyone can type. */
export async function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("hex"));
}

/** Cognito emits email_verified as a boolean in ID tokens but some flows serialise it as a string. */
export function isEmailVerifiedClaim(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Match order (see the Charisol legacy-user-migration guide):
 *   1. `legacy_user_id` — Plexo's OWN user id, only ever set by Charisol for Plexo's client.
 *   2. the verified, lowercased `email`.
 *   3. otherwise create a new user (verified email, no usable password).
 * Returns null for: unverified email, missing email, or a suspended account.
 *
 * Records the Charisol account (`charisolSub`) on the Plexo user. `viaPassword` — this
 * sign-in was Plexo's own email+password form checked by Charisol — also records that
 * Charisol now holds this person's password (`charisolPasswordAt`), after which the local
 * password hash is never accepted again (server/authDynamo.ts).
 */
export async function resolveCharisolUser(
  claims: CharisolClaims,
  opts: { viaPassword?: boolean; /** Which app the person came from; defaults to "charisol" — never a deliberate Plexo sign-up (only the email form in app/api/auth/register is). */ source?: string } = {},
): Promise<CharisolLocalUser | null> {
  if (!isEmailVerifiedClaim(claims.email_verified)) return null;
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email) return null;

  let existing: UserRecord | undefined;

  const legacyUserId = typeof claims.legacy_user_id === "string" ? claims.legacy_user_id.trim() : "";
  if (legacyUserId) {
    const { data } = await User.get({ id: legacyUserId }).go();
    if (data) existing = data;
  }
  if (!existing) existing = await loadByEmail(email);

  const link = { sub: typeof claims.sub === "string" ? claims.sub : undefined, viaPassword: opts.viaPassword === true };
  if (existing) return signInExisting(existing, email, link);

  const id = randomUUID();
  const name = typeof claims.name === "string" && claims.name ? claims.name : email.split("@")[0];
  const image = typeof claims.picture === "string" ? claims.picture : undefined;
  try {
    // Same email-lock transaction as password registration, so one email can never end up
    // with two Plexo accounts (see lib/db/coreOperations.ts).
    await createUserWithEmailLock({ id, email, name, image, isConfirmed: true, passwordHash: await unusablePasswordHash(), signupSource: opts.source ?? "charisol" });
  } catch (err) {
    if (!(err instanceof EmailAlreadyInUseError)) throw err;
    // Lost a race with a concurrent registration/sign-in for this same email. The winning
    // row is this person's account — sign in as it, under the same rules as any existing
    // account (suspended → refused; unconfirmed → confirmed and password rotated).
    const winner = await loadByEmail(email);
    if (!winner) throw err;
    return signInExisting(winner, email, link);
  }
  await User.patch({ id }).set({ signupEventPendingAt: new Date().toISOString() }).go();
  await recordCharisolLink(id, {}, link);
  syncSignupToAlps({ id, email, name, image }, "charisol");
  return { id, email, name, image: image ?? null };
}

type CharisolLink = { sub?: string; viaPassword: boolean };

function linkChanges(existing: { charisolSub?: string; charisolPasswordAt?: string }, link: CharisolLink): Record<string, string> {
  const changes: Record<string, string> = {};
  if (link.sub && existing.charisolSub !== link.sub) changes.charisolSub = link.sub;
  if (link.viaPassword && !existing.charisolPasswordAt) changes.charisolPasswordAt = new Date().toISOString();
  return changes;
}

async function recordCharisolLink(id: string, existing: { charisolSub?: string; charisolPasswordAt?: string }, link: CharisolLink): Promise<void> {
  const changes = linkChanges(existing, link);
  if (Object.keys(changes).length > 0) await User.patch({ id }).set(changes).go();
}

// A real, correctly-identified person whose account an admin has suspended — said plainly
// (instead of "wrong password") so they know to contact support. Only thrown once their
// identity is proven, so it never reveals that an account exists to someone who isn't them.
// Plain Error here (no next-auth import in this module); the two sign-in entry points turn
// it into server/passwordSignIn.ts's SuspendedAccountError, which the login page understands.
export class SuspendedAccountSignal extends Error {
  constructor() {
    super("account suspended");
  }
}

async function signInExisting(existing: UserRecord, email: string, link: CharisolLink): Promise<CharisolLocalUser | null> {
  if (existing.suspendedAt) throw new SuspendedAccountSignal();

  const changes: Record<string, unknown> = linkChanges(existing, link);
  // Pre-registration takeover fix: /api/auth/register lets anyone create an UNCONFIRMED
  // account with a password of their choosing for any email. A Charisol login (with
  // email_verified) proves the real owner controls the address, so confirm the account
  // AND rotate the password hash — otherwise the squatter's password keeps working on
  // the now-confirmed account.
  if (!existing.isConfirmed) {
    changes.isConfirmed = true;
    changes.passwordHash = await unusablePasswordHash();
  }
  if (Object.keys(changes).length > 0) await User.patch({ id: existing.id }).set(changes).go();
  return { id: existing.id, email: existing.email, name: existing.name ?? email.split("@")[0], image: existing.image ?? null };
}

type UserRecord = NonNullable<Awaited<ReturnType<typeof loadByEmail>>>;

async function loadByEmail(email: string) {
  const { data } = await User.query.byEmail({ email }).go();
  return data[0];
}
