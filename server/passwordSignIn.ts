import type { EntityItem } from "electrodb";
import { CredentialsSignin } from "next-auth";
import { verifyPassword } from "@better-auth/utils/password";

import { User } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { SuspendedAccountSignal, isEmailVerifiedClaim, resolveCharisolUser, type CharisolClaims, type CharisolLocalUser } from "@/server/charisolAccount";
import { saveCharisolRefresh } from "@/lib/charisolLink";
import { passwordSignIn, sendResetCode, type PasswordSignInResult } from "@/server/charisolCognito";

// Plexo's email + password sign-in. The person always types into PLEXO's own form; the
// password is checked by Charisol Auth first (so one password works across every Charisol
// product), and Plexo's own stored password only where Charisol doesn't hold it yet:
//
//   Charisol says…        | Plexo user's password held by Charisol? | outcome
//   ----------------------|-----------------------------------------|-----------------------------
//   correct               | (either)                                | signed in; now held by Charisol
//   wrong                 | yes                                     | wrong password
//   wrong                 | no  (not moved across yet)              | Plexo's own password decides
//   not switched on yet   | (either)                                | Plexo's own password decides
//   unavailable           | yes                                     | "try again shortly"
//   unavailable           | no                                      | Plexo's own password decides
//   must choose a new one | no                                      | Plexo's own password decides, else code emailed → reset page
//
// With CHARISOL_PASSWORD_ENFORCED=true (set only once Charisol has approved legacy-verify, so
// existing users are moved across on first sign-in) the first account on Charisol Auth wins
// and Plexo's own password only signs in while Charisol doesn't hold theirs (never a stale one):
//
//   Charisol says…        | typed password = old Plexo password? | outcome
//   ----------------------|--------------------------------------|-----------------------------
//   correct               | —                                    | signed in
//   wrong / not switched  | yes, Charisol doesn't hold theirs    | signed in with Plexo's password
//     on yet              |                                      |
//   wrong / not switched  | yes, Charisol holds theirs (stale)   | wrong password (generic)
//     on yet              | no                                   | wrong password (generic)
//   unavailable           | held by Charisol or not              | "try again shortly" (fail closed)
//   must choose a new one | matches Plexo, none held by Charisol | signed in with Plexo's password
//                         | otherwise                            | code emailed → reset page
//
// Existing users move across on their first sign-in: Charisol doesn't know them, so it asks
// Plexo's /api/charisol/legacy-verify whether the password is right, and if so creates their
// Charisol account with it. Until that endpoint is registered and approved in Charisol's
// Developer Portal, Charisol answers "wrong" for them and Plexo's own password keeps working —
// nobody is locked out at any point of the rollout.

// Thrown from authorize() — NextAuth surfaces `code` as `result.code` from next-auth/react's
// signIn(), which lib/auth-client.ts's signIn.email() maps for the login page.
export class UnverifiedEmailError extends CredentialsSignin {
  code = "unverified_email";
}

// Too many failed/attempted password logins for one email in the current window. Per-email
// rather than per-IP: the useful protection against guessing a specific account's password,
// whichever IPs an attacker spreads attempts across. Reuses the fixed-window limiter
// Commerce/forms/blog-comments rely on (see lib/commerceRateLimitDynamo.ts).
export class TooManyLoginAttemptsError extends CredentialsSignin {
  code = "too_many_attempts";
}

// A real account with no password at all (created via "Continue with Google"): lets the login
// page send them to Google instead of a dead-end "Invalid credentials." A narrow, deliberate
// enumeration signal — capped per IP (GOOGLE_REVEAL_LIMIT) so it can't be farmed at volume.
export class GoogleAccountOnlyError extends CredentialsSignin {
  code = "google_account_only";
}

// Charisol requires this account to choose a new password before signing in (typically an
// existing Plexo password that's weaker than the password rules, moved across on this very
// sign-in). A reset code has already been emailed; the login page goes to the code form.
export class PasswordResetRequiredError extends CredentialsSignin {
  code = "password_reset_required";
}

// The typed password is this person's OLD Plexo password: Charisol holds a newer one (changed there or in another
// Charisol app). Said plainly instead of "incorrect password" so they know to use their latest Charisol password. Only
// thrown when what they typed really is that old password, so it reveals nothing to someone who doesn't know it.
export class PasswordChangedError extends CredentialsSignin {
  code = "password_changed";
}

// Charisol holds this person's password but couldn't be reached — there's nothing else that
// could safely check it, so say so rather than "wrong password".
export class SignInUnavailableError extends CredentialsSignin {
  code = "sign_in_unavailable";
}

// A real, correctly-identified person whose account an admin suspended — said plainly
// (instead of "wrong password") so they know to contact support. Only thrown once their
// identity is proven, so it never reveals that an account exists to someone who isn't them.
export class SuspendedAccountError extends CredentialsSignin {
  code = "account_suspended";
}

/** resolveCharisolUser, with a suspended account reported as SuspendedAccountError. */
export async function resolveCharisolUserOrSuspended(...args: Parameters<typeof resolveCharisolUser>): ReturnType<typeof resolveCharisolUser> {
  try {
    return await resolveCharisolUser(...args);
  } catch (err) {
    if (err instanceof SuspendedAccountSignal) throw new SuspendedAccountError();
    throw err;
  }
}

const GOOGLE_REVEAL_LIMIT = 5;

export interface PasswordSignInDeps {
  passwordSignIn: (email: string, password: string) => Promise<PasswordSignInResult>;
  sendResetCode: (email: string) => Promise<unknown>;
  /** Verifies a Charisol ID token's signature/issuer/audience and returns its claims. */
  verifyIdToken: (idToken: string) => Promise<CharisolClaims>;
}

export async function authorizePassword(
  rawEmail: unknown,
  rawPassword: unknown,
  request: Request,
  deps: Pick<PasswordSignInDeps, "verifyIdToken"> & Partial<PasswordSignInDeps>,
): Promise<CharisolLocalUser | null> {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (!email || !password) return null;

  // 10 attempts / 15 minutes per email — checked before anything else, so a lockout can't be
  // raced by hammering just under the window.
  const allowed = await checkCommerceRateLimit(`login:${email}`, 10, 15 * 60_000);
  if (!allowed) throw new TooManyLoginAttemptsError();

  const { data: matches } = await User.query.byEmail({ email }).go();
  const user = matches[0];
  const heldByCharisol = Boolean(user?.charisolPasswordAt);

  const charisol = await (deps.passwordSignIn ?? passwordSignIn)(email, password);
  const enforced = isCharisolPasswordEnforced();
  switch (charisol.kind) {
    case "ok": {
      let claims: CharisolClaims;
      try {
        claims = await deps.verifyIdToken(charisol.idToken);
      } catch {
        return null;
      }
      if (!isEmailVerifiedClaim(claims.email_verified)) throw new UnverifiedEmailError();
      const signedIn = await resolveCharisolUserOrSuspended(claims, { viaPassword: true });
      // Keep this Charisol sign-in (server-side, encrypted) so connecting Strata needs no second login — the browser sign-in
      // path does the same from its callback page. Best effort: signing in never fails because of it.
      if (signedIn && charisol.refreshToken) await saveCharisolRefresh(signedIn.id, charisol.refreshToken).catch(() => undefined);
      return signedIn;
    }
    case "reset_required": {
      // The password they typed is right in Plexo's own database — that is proof enough, so sign them in rather than
      // making them reset it. Only when Charisol doesn't hold their password yet (otherwise Plexo's copy is stale).
      const viaPlexo = await signInWithPlexoPassword(user, password, heldByCharisol, request);
      if (viaPlexo) return viaPlexo;
      await (deps.sendResetCode ?? sendResetCode)(email).catch(() => undefined);
      throw new PasswordResetRequiredError();
    }
    case "unconfirmed":
      throw new UnverifiedEmailError();
    case "rate_limited":
      throw new TooManyLoginAttemptsError();
    case "wrong_password":
    case "not_enabled":
      if (enforced) {
        const viaPlexo = await signInWithPlexoPassword(user, password, heldByCharisol, request);
        if (!viaPlexo && heldByCharisol) await throwIfOldPlexoPassword(user, password);
        return viaPlexo;
      }
      if (charisol.kind === "wrong_password" && heldByCharisol) {
        await throwIfOldPlexoPassword(user, password);
        return null;
      }
      break;
    case "unavailable":
      if (enforced || heldByCharisol) throw new SignInUnavailableError();
      break;
  }

  return localPasswordCheck(user, password, request);
}

function isCharisolPasswordEnforced(): boolean {
  return process.env.CHARISOL_PASSWORD_ENFORCED?.trim().toLowerCase() === "true";
}

/**
 * Enforced mode: Charisol didn't accept the password (typically the person's Charisol account was made in another app
 * with a different one). If what they typed is nevertheless their correct Plexo password, sign them in — never make them
 * reset a password that is right. Not when Charisol already holds their password: then the Plexo copy is out of date
 * (they changed it there), and the old password must stop working. No match: null, a generic wrong password.
 */
async function signInWithPlexoPassword(
  user: EntityItem<typeof User> | undefined,
  password: string,
  heldByCharisol: boolean,
  request: Request,
): Promise<CharisolLocalUser | null> {
  if (heldByCharisol || !user?.passwordHash || !user.isConfirmed) return null;
  return localPasswordCheck(user, password, request);
}

/** Throws PasswordChangedError when `password` is the person's old Plexo password (so they can be told it was changed). */
async function throwIfOldPlexoPassword(user: EntityItem<typeof User> | undefined, password: string): Promise<void> {
  if (!user?.passwordHash || !user.isConfirmed || user.suspendedAt) return;
  if (password.trim().toLowerCase() === user.email.toLowerCase()) return;
  if (await verifyPassword(user.passwordHash, password)) throw new PasswordChangedError();
}

/** Plexo's own stored password — for accounts Charisol doesn't hold a password for yet. */
async function localPasswordCheck(
  user: EntityItem<typeof User> | undefined,
  password: string,
  request: Request,
): Promise<CharisolLocalUser | null> {
  if (!user) return null; // no account at all — stays generic
  if (!user.passwordHash) {
    // Capped per IP: how many DISTINCT accounts one source can learn are Google-only. Once
    // exhausted, degrade to the generic null a wrong password gets.
    const revealAllowed = await checkCommerceRateLimit(`login-google-reveal:${clientIp(request)}`, GOOGLE_REVEAL_LIMIT, 15 * 60_000);
    if (!revealAllowed) return null;
    throw new GoogleAccountOnlyError();
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return null;
  // A password equal to the account's own email is derivable by anyone — refuse it.
  if (password.trim().toLowerCase() === user.email.toLowerCase()) return null;

  if (!user.isConfirmed) throw new UnverifiedEmailError();
  if (user.suspendedAt) throw new SuspendedAccountError();

  return { id: user.id, email: user.email, name: user.name ?? user.email.split("@")[0], image: user.image ?? null };
}
