import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DynamoDBAdapter } from "@auth/dynamodb-adapter";
import { verifyPassword } from "@better-auth/utils/password";

import { docClient, TABLES } from "@/lib/db/client";
import { User } from "@/lib/db/coreEntities";

// The DynamoDB-backed replacement for server/auth.ts (better-auth). Wired in as the live
// login handler (app/api/auth/[...all]/route.ts, middleware.ts's session-cookie check) as
// of 2026-09-02 — see DYNAMODB_CUTOVER_CHECKLIST.md for the full history: every dashboard/
// API call site had already been reading sessions via this module's `auth()` for most of
// this migration, but nothing could actually PRODUCE an Auth.js session until this file
// grew a Credentials provider (email/password, mirroring plexo-admin's own scrypt-based
// verifyPassword approach) and lib/auth-client.ts's 9 callers were rewired onto
// next-auth/react + the new app/api/auth/{register,verify-email,forgot-password,
// reset-password}/route.ts + app/api/org/route.ts endpoints. Database session strategy +
// Credentials is only valid in Auth.js when at least one non-Credentials provider is also
// configured (verified directly against @auth/core's own assert.js — Google satisfies
// this here); a Credentials-only provider list would need JWT sessions instead.
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
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

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
  // provider including Google; the adapter is still used for User/Account/
  // VerificationToken persistence, just not Session rows.
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
