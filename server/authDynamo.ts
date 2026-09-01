import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DynamoDBAdapter } from "@auth/dynamodb-adapter";

import { docClient, TABLES } from "@/lib/db/client";

// The DynamoDB-backed replacement for server/auth.ts (better-auth). NOT wired into the
// live app yet — server/auth.ts is still what actually runs in production. This becomes
// the real thing at Phase 8's cutover, once Phase 1's organizations/invitations parity
// is proven and the data migration (Phase 7) has run.
//
// Shares plexo-core with our own Organization/Member/User(-profile) entities
// (lib/db/coreEntities.ts) via the adapter's configurable table/key names — same
// pk/sk/GSI1PK/GSI1SK convention throughout, not a second table.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DynamoDBAdapter(docClient, {
    tableName: TABLES.core,
    partitionKey: "pk",
    sortKey: "sk",
    indexName: "GSI1",
    indexPartitionKey: "GSI1PK",
    indexSortKey: "GSI1SK",
  }),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
