/**
 * better-auth -> Auth.js user identity migration.
 *
 * Same not-run-here caveat as backfillCore.ts — no DATABASE_URL loaded in this session,
 * and this doesn't run against production without an explicit human decision on timing.
 *
 * Preserves each user's existing Postgres UUID as their Auth.js id, so it stays the same
 * value as lib/db/coreEntities.ts's business-profile User.id (see
 * docs/auth-migration-design.md — the two records share an id by convention). This is
 * why @auth/dynamodb-adapter's own createUser() isn't used: it always generates a fresh
 * random id (verified by reading node_modules/@auth/dynamodb-adapter/index.js directly),
 * which would break every existing foreign key referencing the current id. The item
 * shape below is copied from that same verified source, not guessed.
 *
 * Real UX consideration this surfaces, not just a technical migration detail: the app
 * has no Google OAuth today (confirmed — server/auth.ts has no socialProviders config),
 * only email/password. So there's no existing OAuth "Account" linkage to migrate here —
 * only User identity records. The first time an existing user signs in with Google
 * post-cutover, Auth.js resolves by email (this script's whole point is making that
 * resolve to the SAME existing user, not create a duplicate) — whether that auto-links
 * or needs an explicit "link this Google account to your existing email" step is an
 * Auth.js configuration decision for Phase 1's remaining work, not something this script
 * decides.
 *
 * Usage: tsx scripts/migration/backfillAuthUsers.ts [--dry-run] [--resume]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "@/server/prisma";
import { docClient, TABLES } from "@/lib/db/client";

const PAGE_SIZE = 200;
const CHECKPOINT_FILE = ".migration-checkpoint-auth-users.json";

// Matches @auth/dynamodb-adapter's own defaults exactly (tableName/keys are
// configurable, but server/authDynamo.ts uses the defaults) — verified against
// node_modules/@auth/dynamodb-adapter/index.js, not assumed.
function toAuthJsUserItem(user: { id: string; name: string; email: string; image: string | null; isConfirmed: boolean; createdAt: Date }) {
  return {
    pk: `USER#${user.id}`,
    sk: `USER#${user.id}`,
    type: "USER",
    GSI1PK: `USER#${user.email}`,
    GSI1SK: `USER#${user.email}`,
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? undefined,
    // better-auth's isConfirmed maps to Auth.js's emailVerified — Auth.js expects
    // either a Date (verified, with a timestamp) or null (unverified), not a boolean.
    emailVerified: user.isConfirmed ? user.createdAt.toISOString() : null,
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");

  if (!resume && existsSync(CHECKPOINT_FILE)) {
    throw new Error(`${CHECKPOINT_FILE} already exists — pass --resume or delete it to start fresh.`);
  }

  let cursor: string | null = resume && existsSync(CHECKPOINT_FILE) ? JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8")).cursor : null;
  let total = 0;

  console.log(`Starting auth-user backfill (dryRun=${dryRun}, resume=${resume})`);

  while (true) {
    const batch = await prisma.user.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, name: true, email: true, image: true, isConfirmed: true, createdAt: true },
    });

    if (batch.length === 0) break;

    if (!dryRun) {
      // Plain BatchWriteItem, not ElectroDB — these items belong to Auth.js's own
      // schema, not one of our ElectroDB entities, so there's no entity to route the
      // write through.
      const putRequests = batch.map((u) => ({ PutRequest: { Item: toAuthJsUserItem(u) } }));
      // DynamoDB's BatchWriteItem caps at 25 items per call.
      for (let i = 0; i < putRequests.length; i += 25) {
        await docClient.batchWrite({ RequestItems: { [TABLES.core]: putRequests.slice(i, i + 25) } });
      }
    }

    total += batch.length;
    cursor = batch[batch.length - 1].id;
    console.log(`Auth users: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    writeFileSync(CHECKPOINT_FILE, JSON.stringify({ cursor }, null, 2));

    if (batch.length < PAGE_SIZE) break;
  }

  console.log(`Auth-user backfill complete: ${total} total.`);
}

main()
  .catch((err) => {
    console.error("Auth-user backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
