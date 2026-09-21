import { decode } from "next-auth/jwt";

import { User } from "@/lib/db/coreEntities";
import { membershipsForUser, ensurePersonalWorkspace, ACTIVE_ORG_COOKIE } from "@/server/orgMemberships";
import { resolveManageLandingPagePublishing } from "@/lib/subscription";
import type { OrgRole } from "@/server/accessControl";

// Resolves a NextAuth v5 (Auth.js) session cookie into the same shape
// lib/auth/resolveUser.ts's session branch produces, WITHOUT using Next.js's `auth()`
// helper — this file runs inside a bare Lambda Function URL handler (lambda/sol-chat/
// index.ts), not a Next.js request, so `auth()`/`cookies()`/`headers()` (all backed by
// Next.js's AsyncLocalStorage request-context machinery) simply aren't available here.
//
// APPROACH: server/authDynamo.ts configures `session: { strategy: "jwt" }` with no custom
// `secret` or cookie options, which means Auth.js's own defaults apply throughout:
//   - The session cookie is named "authjs.session-token", or "__Secure-authjs.session-
//     token" once `useSecureCookies` is true (confirmed against this exact installed
//     version's cookie.js: `useSecureCookies` flips the cookie's `secure` flag AND its
//     name prefix together, driven by whether the request looks like it's over HTTPS).
//     middleware.ts's own dashboard-cookie check already relies on this same name (see its
//     `cookie.name.includes("authjs.session-token")` check) — this file follows the same
//     precedent, just checking both concrete names since it doesn't have Next.js's
//     "secureCookie" auto-detection helper available.
//   - The JWT is an encrypted (JWE, A256CBC-HS512) Auth.js token, decodable with
//     `@auth/core/jwt`'s `decode()` given the same `secret` (AUTH_SECRET) and the same
//     `salt` Auth.js itself uses to decode it — confirmed by reading this installed
//     version's own actions/session.js and actions/callback/index.js: every call site
//     passes `salt: options.cookies.sessionToken.name`, i.e. the cookie's own name, not a
//     fixed string. `next-auth/jwt` re-exports `@auth/core/jwt` verbatim (checked via
//     node -e against the installed package), so this uses the exact same decode logic
//     server/authDynamo.ts's NextAuth() instance relies on internally — not a
//     reimplementation that could silently drift from it.
//   - A successful decode's `token.sub` is the user id: server/authDynamo.ts's own `jwt`
//     callback sets `token.sub = user.id` on login and never touches it again, so it's
//     stable for the life of the token.
//
// LIMITATIONS (deliberate, matching how a middleware-less session check normally behaves
// in NextAuth v5):
//   - This only validates the CURRENT token's signature/encryption and expiry. It does not
//     perform Auth.js's own "session update" (JWT rolling-refresh) that middleware/`auth()`
//     normally do on every request — a session that's within its maxAge but would have been
//     refreshed by a browser request keeps whatever `exp` it already has. Not a security
//     gap (decode() itself enforces `exp`), just means this Lambda never itself extends a
//     session's lifetime the way hitting the Next.js app does.
//   - No CSRF double-submit check — irrelevant here: this is a same-origin, cookie-read-only
//     path (no state-changing OAuth callback), the same trust boundary resolveUser.ts's own
//     cookie-session branch already operates under.
//   - KNOWN DEPLOYED-ENVIRONMENT GAP: as of this task, cdk/lib/compute-stack.ts's SolChatFn
//     construct does NOT inject an AUTH_SECRET environment variable (confirmed by reading
//     that file — its `environment` block only sets `...tableEnv`, `PLEXO_ENV`, and
//     `PLEXO_ORIGIN_VERIFY_SECRET`), unlike the main Next.js server function, which gets
//     AUTH_SECRET via its own `.env`-bundling path (see that stack's own long comment on
//     `loadSecretsFromSsm`'s short-circuit). This file is intentionally NOT edited to work
//     around that — compute-stack.ts is out of scope for this task — so until a follow-up
//     infra change adds AUTH_SECRET to SolChatFn's environment (the same way
//     PLEXO_ORIGIN_VERIFY_SECRET was baked in), `resolveSessionUser` below will always fail
//     closed (return null) in any real deployed environment, not just reject bad/expired
//     cookies. Flagged loudly here (and in this task's final report) rather than silently
//     guessed around.

export interface LambdaResolvedUser {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  subscriptionPlan: string;
  customDomainLimit: number | null;
  manageLandingPagePublishing: boolean;
}

const SESSION_COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

/** Parses a Lambda Function URL event's cookies (the `cookies: string[]` array API Gateway
 * v2 payloads carry, each a raw "name=value" pair) into a name->value map. Also accepts a
 * raw `Cookie` header as a fallback, in case a caller/proxy ever collapses them into one
 * header instead (API Gateway v2 always splits them, but Function URLs are a thinner layer
 * over the same payload shape and this costs nothing to also support). */
export function parseCookies(input: { cookies?: string[]; headerCookie?: string | null }): Record<string, string> {
  const pairs: string[] = [];
  if (input.cookies) pairs.push(...input.cookies);
  if (input.headerCookie) pairs.push(...input.headerCookie.split(";"));

  const map: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) map[name] = decodeURIComponent(value);
  }
  return map;
}

/** Decodes whichever Auth.js session cookie is present (secure-prefixed or not) into its
 * JWT payload, or null if absent/invalid/expired/misconfigured. */
async function decodeSessionCookie(cookies: Record<string, string>): Promise<{ sub?: string } | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error(
      "sessionAuth: AUTH_SECRET is not set in this Lambda's environment — cannot verify any session cookie. " +
        "See this file's own top-of-file comment: SolChatFn's CDK definition doesn't currently inject it.",
    );
    return null;
  }

  for (const cookieName of SESSION_COOKIE_NAMES) {
    const token = cookies[cookieName];
    if (!token) continue;
    try {
      const payload = await decode({ token, secret, salt: cookieName });
      if (payload) return payload as { sub?: string };
    } catch (err) {
      console.warn(`sessionAuth: failed to decode "${cookieName}" cookie:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

/**
 * Resolves the same {userId, organizationId, role, subscriptionPlan, customDomainLimit,
 * manageLandingPagePublishing} shape lib/auth/resolveUser.ts's session branch produces, so
 * every SOL tool dispatched via lib/mcp/mcpServer.ts's dispatchMcpTool (which types its
 * `resolved` parameter as exactly that shape, see ResolvedUser there) can be called
 * identically regardless of whether the request came through the main Next.js app or this
 * Lambda. Returns null for any failure (missing/invalid cookie, unknown user, or an
 * "needs-choice" multi-org account with no active-org cookie set) — same "just
 * unauthenticated" contract resolveUser.ts's session branch has, deliberately not
 * distinguishing WHY to the caller (mirrors that file's own behavior exactly).
 *
 * Unlike resolveUser.ts, this has no API-key/Bearer-token fallback — SOL's chat endpoints
 * are dashboard-UI-only (cookie session required), not part of the public v1 API surface
 * third-party API keys can call.
 */
export async function resolveSessionUser(cookies: Record<string, string>): Promise<LambdaResolvedUser | null> {
  const payload = await decodeSessionCookie(cookies);
  const userId = payload?.sub;
  if (!userId) return null;

  const { data: user } = await User.get({ id: userId }).go();
  if (!user) return null;

  const activeOrgId = cookies[ACTIVE_ORG_COOKIE];
  const memberships = await membershipsForUser(userId);

  let organizationId: string | null = null;
  let role: OrgRole | null = null;

  if (activeOrgId) {
    const active = memberships.find((m) => m.organizationId === activeOrgId);
    if (active) {
      organizationId = active.organizationId;
      role = active.role;
    }
  }

  if (!organizationId) {
    if (memberships.length === 0) {
      // Same auto-provisioning ensureActiveOrganization itself does for a brand-new
      // user — reused verbatim (see ensurePersonalWorkspace's own export comment) so a
      // user whose very first SOL interaction happens to hit this Lambda before ever
      // loading the dashboard still gets a workspace instead of a confusing 401.
      const org = await ensurePersonalWorkspace(userId, `${user.name ?? "My"}'s Workspace`);
      organizationId = org.id;
      role = "owner";
    } else if (memberships.length === 1) {
      organizationId = memberships[0].organizationId;
      role = memberships[0].role;
    } else {
      // Multiple orgs, no (valid) active-org cookie — same "needs-choice, treat as
      // unauthenticated" outcome resolveUser.ts's session branch has via
      // ensureActiveOrganization's `status === "needs-choice"` check.
      return null;
    }
  }

  return {
    userId: user.id,
    organizationId,
    role,
    subscriptionPlan: user.subscriptionPlan ?? "FREE",
    customDomainLimit: user.customDomainLimit ?? null,
    manageLandingPagePublishing: resolveManageLandingPagePublishing(
      user.subscriptionPlan ?? "FREE",
      user.manageLandingPagePublishing ?? false,
    ),
  };
}
