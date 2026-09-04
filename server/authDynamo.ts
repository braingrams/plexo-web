import { randomUUID } from "node:crypto";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DynamoDBAdapter } from "@auth/dynamodb-adapter";
import { verifyPassword } from "@better-auth/utils/password";
import { CognitoJwtVerifier } from "aws-jwt-verify";

import { docClient, TABLES } from "@/lib/db/client";
import { User } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";

// Verifies Charisol/Cognito-issued ID tokens server-side before trusting any claim in
// them — checks signature against the shared products User Pool's JWKS *and* that the
// token was issued to Plexo's own client_id specifically, since the pool is shared across
// every Charisol product (see docs/verifying-tokens.md in the Charisol Auth repo).
//
// Built lazily (on first actual authorize() call below), not at module scope, deliberately:
// Next.js's build process imports route handler modules like app/api/auth/[...all]/route.ts
// to read their static exports, which executes this file's top-level code during `next
// build` itself — confirmed the hard way by this same migration's AUTH_SECRET, where
// NextAuth()'s own eager validation threw at build time until it was fetched into the CI
// build env specially (see deploy-staging.yml's comment on that step). CHARISOL_USER_POOL_ID
// is never set in the build environment (only at Lambda runtime, via lib/ssmEnv.ts's
// register()-time backfill) — constructing this eagerly would permanently bake in an empty
// userPoolId. Deferring construction to first real use guarantees it only ever runs inside
// a request, after that backfill has already populated process.env.
let charisolVerifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;
function getCharisolVerifier() {
  if (!charisolVerifier) {
    charisolVerifier = CognitoJwtVerifier.create({
      userPoolId: process.env.CHARISOL_USER_POOL_ID ?? "",
      tokenUse: "id",
      clientId: process.env.NEXT_PUBLIC_CHARISOL_CLIENT_ID ?? "",
    });
  }
  return charisolVerifier;
}

// The DynamoDB-backed replacement for server/auth.ts (better-auth). Wired in as the live
// login handler (app/api/auth/[...all]/route.ts, middleware.ts's session-cookie check) as
// of 2026-09-02 — see DYNAMODB_CUTOVER_CHECKLIST.md for the full history: every dashboard/
// API call site had already been reading sessions via this module's `auth()` for most of
// this migration, but nothing could actually PRODUCE an Auth.js session until this file
// grew a Credentials provider (email/password, mirroring plexo-admin's own scrypt-based
// verifyPassword approach) and lib/auth-client.ts's 9 callers were rewired onto
// next-auth/react + the new app/api/auth/{register,verify-email,forgot-password,
// reset-password}/route.ts + app/api/org/route.ts endpoints. Both providers below are
// Credentials providers (the Google one was replaced by the "charisol" bridge further
// down) — fine under `session: {strategy: "jwt"}` below; a database session strategy would
// require at least one non-Credentials provider instead (verified against @auth/core's
// own assert.js), which is why that strategy isn't used here.
//
// Shares plexo-core with our own Organization/Member/User(-profile) entities
// (lib/db/coreEntities.ts) via the adapter's configurable table/key names — same
// pk/sk/GSI1PK/GSI1SK convention throughout, not a second table.
export const dynamoAdapter = DynamoDBAdapter(docClient, {
  tableName: TABLES.core,
  partitionKey: "pk",
  sortKey: "sk",
  indexName: "GSI1",
  indexPartitionKey: "GSI1PK",
  indexSortKey: "GSI1SK",
});

// Thrown from the Credentials provider's authorize() below — NextAuth surfaces this as
// `result.error === "unverified_email"` from next-auth/react's signIn(), which
// lib/auth-client.ts's signIn.email() shim maps back to the {status: 403, message} shape
// app/auth/login/page.tsx already checks for (same UX as better-auth's own 403 previously).
export class UnverifiedEmailError extends CredentialsSignin {
  code = "unverified_email";
}

// Thrown when a single email address has had too many failed/attempted password logins in
// the current window — closes a real gap (there was previously zero brute-force protection
// on this provider) without needing IP access, which authorize()'s signature doesn't give
// us here; per-email is also the more directly useful protection against credential
// stuffing/guessing a specific account's password, regardless of which IP an attacker uses.
// Reuses the same fixed-window limiter Commerce/forms/blog-comments already rely on — see
// lib/commerceRateLimitDynamo.ts's own comment on why this trade-off (not linearizable
// under extreme concurrency) is fine for abuse-throttling.
export class TooManyLoginAttemptsError extends CredentialsSignin {
  code = "too_many_attempts";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: dynamoAdapter,
  // Required self-hosted (not Vercel, where Auth.js auto-trusts Vercel's own edge) — Auth.js
  // refuses to construct callback/reset-link URLs from a request's Host by default
  // (UntrustedHost) unless explicitly told the reverse proxy validates it. Safe here: the
  // CloudFront Function (cdk/lib/forward-host-function.js) is the only source of
  // x-forwarded-host Auth.js reads, and it runs upstream of the origin request policy that
  // would otherwise strip the header entirely, so nothing downstream of CloudFront can
  // override what it forwards on a per-distribution basis. The dashboard's own distribution
  // (compute-stack.ts) currently has no alias restriction on its default *.cloudfront.net
  // domain, so a direct request there COULD still present an arbitrary Host — tightening
  // that (requiring the real custom domain, rejecting the bare CloudFront domain) is a
  // follow-up hardening step, not yet done.
  trustHost: true,
  providers: [
    // "Continue with Google", routed through Charisol's centralized Cognito-fronted
    // Google IdP instead of a Plexo-owned Google Cloud OAuth client — app/auth/
    // GoogleAuthButton.tsx drives @charisol/auth-sdk-web's browser-side PKCE flow
    // directly, and app/auth/charisol/callback/page.tsx hands the resulting ID token to
    // this provider once the redirect completes. No Google client ID/secret lives in
    // Plexo anymore; charisolVerifier above is what actually re-establishes trust in the
    // token before any claim in it is used.
    Credentials({
      id: "charisol",
      name: "Charisol",
      credentials: { idToken: {} },
      async authorize(credentials) {
        const idToken = typeof credentials?.idToken === "string" ? credentials.idToken : "";
        if (!idToken) return null;

        let claims;
        try {
          claims = await getCharisolVerifier().verify(idToken);
        } catch {
          return null; // bad signature, wrong client_id/aud, expired, or malformed
        }

        const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
        if (!email) return null;

        const { data: matches } = await User.query.byEmail({ email }).go();
        const existing = matches[0];
        if (existing?.suspendedAt) return null;
        if (existing) {
          return { id: existing.id, email: existing.email, name: existing.name, image: existing.image ?? null };
        }

        const id = randomUUID();
        const name = typeof claims.name === "string" && claims.name ? claims.name : email.split("@")[0];
        const image = typeof claims.picture === "string" ? claims.picture : undefined;
        // Google-verified email via Cognito — same trust level the old Google provider
        // implicitly granted, so this account doesn't need Plexo's own email-verification
        // step (isConfirmed gate only applies to the Credentials/password provider above).
        await User.create({ id, email, name, image, isConfirmed: true }).go();
        return { id, email, name, image: image ?? null };
      },
    }),
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        // 10 attempts / 15 minutes per email — checked before touching the DB/password
        // hash at all, so a lockout can't be raced by hammering just under the window.
        const allowed = await checkCommerceRateLimit(`login:${email}`, 10, 15 * 60_000);
        if (!allowed) throw new TooManyLoginAttemptsError();

        const { data: matches } = await User.query.byEmail({ email }).go();
        const user = matches[0];
        if (!user || !user.passwordHash) return null; // Google-only accounts have no passwordHash to check against

        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) return null;

        if (!user.isConfirmed) throw new UnverifiedEmailError();
        if (user.suspendedAt) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image ?? null };
      },
    }),
  ],
  // JWT, not database, sessions — confirmed directly against @auth/core's own source
  // (lib/actions/callback/index.js's credentials branch): the Credentials provider
  // unconditionally jwt.encode()s the session cookie and never calls adapter.createSession,
  // regardless of session.strategy. With strategy:"database" (this file's original setting)
  // auth() then tries to look up that JWT string as a stored session id via
  // getSessionAndUser() and always finds nothing — every credentials login appeared to
  // succeed (password verified, cookie set) but session() always came back null, bouncing
  // straight back to the login page. This is documented upstream Auth.js behavior, not
  // something a second provider works around — JWT strategy applies uniformly to every
  // provider; the adapter is still used for User/Account/VerificationToken persistence,
  // just not Session rows.
  session: { strategy: "jwt" },
  callbacks: {
    // Every call site across the app (server/orgDynamo.ts, /api/org/*, etc.) reads
    // session.user.id — under jwt strategy the session callback receives `token`, not
    // `user` (token.sub is the user id, set from authorize()'s returned `id` on login).
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
