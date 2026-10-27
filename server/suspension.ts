import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { docClient, TABLES } from "@/lib/db/client";

// Whether an account is suspended, checked on every session read (server/authDynamo.ts's
// jwt callback) so suspending someone ends their sign-in everywhere right away rather than
// whenever their session cookie happens to expire. A short per-instance memo keeps that to
// about one tiny read per user per 30 seconds instead of one per request — a suspension
// therefore takes effect within 30 seconds on any server instance.
//
// Raw client + the User item's key (USER#<id> / USER#METADATA, lib/db/coreEntities.ts), not
// the ElectroDB entity: server/authDynamo.ts deliberately stays off the entities, and
// importing them here pulled them into its bundle and broke the production build.

const TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;
const cache = new Map<string, { suspended: boolean; at: number }>();

export async function isUserSuspended(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.suspended;

  // On a read failure, keep whatever we last knew rather than signing everyone out because
  // DynamoDB hiccuped — failing closed here would turn a blip into a full outage.
  const suspended = await docClient
    .send(new GetCommand({ TableName: TABLES.core, Key: { pk: `USER#${userId}`, sk: "USER#METADATA" }, ProjectionExpression: "suspendedAt" }))
    .then(({ Item }) => !!Item?.suspendedAt)
    .catch(() => hit?.suspended ?? false);

  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(userId, { suspended, at: Date.now() });
  return suspended;
}
