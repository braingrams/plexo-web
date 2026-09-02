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
  session: { strategy: "database" },
  callbacks: {
    // Auth.js doesn't put `id` on session.user by default even with the database
    // strategy (verified — it's a documented, deliberate omission, not a bug) — every
    // call site across the app (server/orgDynamo.ts, /api/org/*, etc.) reads
    // session.user.id, so this is required, not an enhancement.
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
