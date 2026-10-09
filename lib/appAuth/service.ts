import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import type { AppContext } from "@/lib/appRuntime/context";
import { hashPassword, verifyPassword, passwordProblem, normalizeEmail } from "./passwords";
import * as store from "./store";
import { sendMagicLinkEmail, sendVerifyEmail, sendResetEmail } from "./emails";
import type { AppUserRow, PublicUser } from "./store";

// Visitor sign-in for apps built on Plexo: the flows behind plexo.auth.* in the app's
// client. Error messages are written for the app's visitors (they show up in the app's own
// UI), and never reveal whether an email has an account where that would matter.

export class AuthError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code?: string) {
    super(message);
  }
}

export type RequestMeta = { ipHash: string; userAgent: string | null };
export type SignedIn = { user: PublicUser; sessionToken: string };

const WINDOW = 10 * 60_000;
async function limit(key: string, max: number): Promise<void> {
  if (!(await checkCommerceRateLimit(`appauth:${key}`, max, WINDOW))) {
    throw new AuthError("Too many attempts. Please wait a few minutes and try again.", 429, "rate_limited");
  }
}

function requireEmail(raw: unknown): string {
  const email = normalizeEmail(raw);
  if (!email) throw new AuthError("Enter a valid email address.", 400, "invalid_email");
  return email;
}

function cleanMetadata(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new AuthError("Profile data must be an object.");
  const json = JSON.stringify(raw);
  if (json.length > 8_000) throw new AuthError("Profile data is too large.");
  return raw as Record<string, unknown>;
}

/** Only the app's own pages (or origins the owner allowed) can be sent to after sign-in. */
export function safeRedirect(ctx: AppContext, raw: unknown, fallback = "/"): string {
  const base = `${ctx.origin}/`;
  if (typeof raw !== "string" || !raw) return new URL(fallback, base).toString();
  try {
    const url = new URL(raw, base);
    const allowed = [ctx.origin, ...(ctx.settings.extraRedirectOrigins ?? [])];
    if (allowed.includes(url.origin) && (url.protocol === "https:" || url.hostname.endsWith("localhost"))) return url.toString();
  } catch {
    // fall through
  }
  return new URL(fallback, base).toString();
}

const apiUrl = (ctx: AppContext, path: string) => `${ctx.origin}/__plexo/api${path}`;

async function startSession(ctx: AppContext, user: AppUserRow, meta: RequestMeta): Promise<SignedIn> {
  const sessionToken = await store.createSession(ctx, user.id, meta);
  return { user: store.toPublicUser(user), sessionToken };
}

export async function signUp(ctx: AppContext, input: { email?: unknown; password?: unknown; data?: unknown; redirectTo?: unknown }, meta: RequestMeta): Promise<SignedIn | { needsEmailConfirmation: true }> {
  const s = ctx.settings;
  if (!s.allowSignups) throw new AuthError("Sign-ups are closed for this app. Ask its owner for an invitation.", 403, "signups_disabled");
  if (!s.authPassword) throw new AuthError("Signing up with a password isn't enabled for this app.", 403, "provider_disabled");
  const email = requireEmail(input.email);
  const problem = passwordProblem(input.password);
  if (problem) throw new AuthError(problem, 400, "weak_password");
  const metadata = cleanMetadata(input.data);
  await limit(`signup:${ctx.templateId}:${meta.ipHash}`, 10);

  const user = await store.createUser(ctx, { email, passwordHash: await hashPassword(input.password as string), metadata });
  if (!user) {
    if (s.requireEmailConfirmation) return { needsEmailConfirmation: true }; // same answer either way
    throw new AuthError("An account with this email already exists. Sign in instead.", 409, "user_exists");
  }
  if (s.requireEmailConfirmation) {
    const token = await store.issueToken(ctx, "verify_email", { userId: user.id, email, data: { redirectTo: safeRedirect(ctx, input.redirectTo) } });
    await sendVerifyEmail(ctx, email, `${apiUrl(ctx, "/auth/verify")}?type=verify_email&token=${token}`);
    return { needsEmailConfirmation: true };
  }
  return startSession(ctx, user, meta);
}

export async function signInWithPassword(ctx: AppContext, input: { email?: unknown; password?: unknown }, meta: RequestMeta): Promise<SignedIn> {
  if (!ctx.settings.authPassword) throw new AuthError("Signing in with a password isn't enabled for this app.", 403, "provider_disabled");
  const email = requireEmail(input.email);
  if (typeof input.password !== "string" || !input.password) throw new AuthError("Enter your password.");
  await limit(`login:${ctx.templateId}:${meta.ipHash}`, 20);
  await limit(`login:${ctx.templateId}:${email}`, 10);
  const user = await store.findUserByEmail(ctx, email);
  const valid = await verifyPassword(input.password, user?.password_hash);
  if (!user || !valid) throw new AuthError("That email and password don't match.", 401, "invalid_credentials");
  if (user.disabled_at) throw new AuthError("This account has been disabled.", 403, "user_disabled");
  if (ctx.settings.requireEmailConfirmation && !user.email_confirmed_at) {
    throw new AuthError("Confirm your email first — check your inbox for the link we sent.", 403, "email_not_confirmed");
  }
  return startSession(ctx, user, meta);
}

export async function sendMagicLink(ctx: AppContext, input: { email?: unknown; redirectTo?: unknown; data?: unknown }, meta: RequestMeta): Promise<void> {
  if (!ctx.settings.authMagicLink) throw new AuthError("Email sign-in links aren't enabled for this app.", 403, "provider_disabled");
  const email = requireEmail(input.email);
  await limit(`magic:${ctx.templateId}:${meta.ipHash}`, 10);
  await limit(`magic:${ctx.templateId}:${email}`, 5);
  const user = await store.findUserByEmail(ctx, email);
  if (!user && !ctx.settings.allowSignups) return; // silently: don't reveal who has an account
  if (user?.disabled_at) return;
  const token = await store.issueToken(ctx, "magic_link", {
    userId: user?.id ?? null,
    email,
    data: { redirectTo: safeRedirect(ctx, input.redirectTo), metadata: cleanMetadata(input.data) },
  });
  await sendMagicLinkEmail(ctx, email, `${apiUrl(ctx, "/auth/verify")}?type=magic_link&token=${token}`);
}

/** Completes an emailed link (magic sign-in, email confirmation, invitation). Returns where
 * to send the visitor, signed in. */
export async function verifyLink(ctx: AppContext, type: string, token: string, meta: RequestMeta): Promise<{ redirectTo: string; signedIn?: SignedIn; error?: string }> {
  const fallback = safeRedirect(ctx, "/");
  if (type !== "magic_link" && type !== "verify_email" && type !== "invite") return { redirectTo: fallback, error: "That link isn't valid." };
  const used = await store.consumeToken(ctx, type, token);
  if (!used) return { redirectTo: fallback, error: "That link has expired or was already used. Request a new one." };
  const redirectTo = safeRedirect(ctx, used.data.redirectTo);
  let user = used.userId ? await store.findUserById(ctx, used.userId) : used.email ? await store.findUserByEmail(ctx, used.email) : null;
  if (!user && used.email && type === "magic_link" && ctx.settings.allowSignups) {
    user = await store.createUser(ctx, { email: used.email, metadata: (used.data.metadata as Record<string, unknown>) ?? {}, confirmed: true }) ?? (await store.findUserByEmail(ctx, used.email));
  }
  if (!user) return { redirectTo, error: "That account no longer exists." };
  if (user.disabled_at) return { redirectTo, error: "This account has been disabled." };
  user = (await store.updateUser(ctx, user.id, { confirmEmail: true })) ?? user;
  return { redirectTo, signedIn: await startSession(ctx, user, meta) };
}

export async function sendPasswordReset(ctx: AppContext, input: { email?: unknown; redirectTo?: unknown }, meta: RequestMeta): Promise<void> {
  const email = requireEmail(input.email);
  await limit(`recover:${ctx.templateId}:${meta.ipHash}`, 10);
  await limit(`recover:${ctx.templateId}:${email}`, 3);
  const user = await store.findUserByEmail(ctx, email);
  if (!user || user.disabled_at) return; // same answer whether or not the account exists
  const token = await store.issueToken(ctx, "reset_password", { userId: user.id, email });
  const page = new URL(safeRedirect(ctx, input.redirectTo, "/reset-password"));
  page.searchParams.set("token", token);
  await sendResetEmail(ctx, email, page.toString());
}

export async function resetPassword(ctx: AppContext, input: { token?: unknown; password?: unknown }, meta: RequestMeta): Promise<SignedIn> {
  const problem = passwordProblem(input.password);
  if (problem) throw new AuthError(problem, 400, "weak_password");
  await limit(`reset:${ctx.templateId}:${meta.ipHash}`, 20);
  const used = await store.consumeToken(ctx, "reset_password", String(input.token ?? ""));
  if (!used?.userId) throw new AuthError("That reset link has expired or was already used. Request a new one.", 400, "invalid_token");
  const user = await store.updateUser(ctx, used.userId, { passwordHash: await hashPassword(input.password as string), confirmEmail: true });
  if (!user || user.disabled_at) throw new AuthError("That account can't be reset.", 403);
  // A reset means the old password may be compromised: sign out everywhere else.
  await store.deleteUserSessions(ctx, user.id);
  return startSession(ctx, user, meta);
}

export async function updateSignedInUser(
  ctx: AppContext,
  current: { user: AppUserRow; sessionToken: string },
  input: { password?: unknown; currentPassword?: unknown; data?: unknown },
): Promise<PublicUser> {
  const changes: Parameters<typeof store.updateUser>[2] = {};
  if (input.password !== undefined) {
    const problem = passwordProblem(input.password);
    if (problem) throw new AuthError(problem, 400, "weak_password");
    if (current.user.password_hash && !(await verifyPassword(String(input.currentPassword ?? ""), current.user.password_hash))) {
      throw new AuthError("Your current password isn't right.", 401, "invalid_credentials");
    }
    changes.passwordHash = await hashPassword(input.password as string);
  }
  if (input.data !== undefined) changes.metadata = cleanMetadata(input.data);
  const user = await store.updateUser(ctx, current.user.id, changes);
  if (!user) throw new AuthError("Your account no longer exists.", 404);
  if (changes.passwordHash) await store.deleteUserSessions(ctx, user.id, current.sessionToken);
  return store.toPublicUser(user);
}

// Short in-memory cache of session → user, so a burst of data calls from one page doesn't
// look the session up every time. Sign-out clears it on this instance; elsewhere a removed
// session stops working within SESSION_CACHE_MS.
const SESSION_CACHE_MS = 30_000;
const sessionCache = new Map<string, { user: AppUserRow | null; at: number }>();

export async function currentUser(ctx: AppContext, sessionToken: string | null): Promise<AppUserRow | null> {
  if (!sessionToken) return null;
  const key = `${ctx.database}:${sessionToken}`;
  const hit = sessionCache.get(key);
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit.user;
  const user = await store.resolveSessionUser(ctx, sessionToken);
  sessionCache.set(key, { user, at: Date.now() });
  if (sessionCache.size > 5000) sessionCache.delete(sessionCache.keys().next().value!);
  return user;
}

export async function signOut(ctx: AppContext, sessionToken: string | null): Promise<void> {
  if (!sessionToken) return;
  sessionCache.delete(`${ctx.database}:${sessionToken}`);
  await store.deleteSession(ctx, sessionToken);
}
