/**
 * Postgres -> DynamoDB backfill, PageView (+ PageViewDailyStat rollup).
 *
 * Originally deliberately excluded from backfillLedgerOps.ts's migration ("ephemeral/
 * TTL'd operational data that repopulates from live traffic, not worth historically
 * backfilling") — reversed on explicit request: existing users' historical traffic
 * numbers on the dashboard overview (Views · 7d) and plexo-admin's analytics matter to
 * them, so losing ~40 days of real history isn't an acceptable tradeoff after all.
 *
 * Two writes per source row:
 *
 * 1. PageView itself — `createdAt` is `readOnly` with no `set` callback (see
 *    opsEntities.ts), so `.put()` preserves the real historical timestamp, same
 *    confirmed ElectroDB behavior backfillLedgerOps.ts already relies on. `ttl` is
 *    computed from that real createdAt (180 days out), not from "now" — a row backfilled
 *    today should still expire on the same schedule it would have if it had been written
 *    live back when the view actually happened, not get an artificially extended life.
 *
 * 2. PageViewDailyStat rollup — recordPageViewRollup() (lib/analyticsRollup.ts) is the
 *    live per-request writer, but calling it once per historical row here would mean
 *    ~3,400 rows x 6 dimensions = ~20,000 individual `.add()` calls for what is, in the
 *    end, only a few hundred distinct (date, dimension) pairs. Instead this aggregates
 *    every row in memory first (same 6 dimensions recordPageViewRollup uses, kept
 *    duplicated rather than imported since that function is fire-and-forget-shaped for a
 *    single live request, not a bulk accumulator) and issues one `.add({views: N})` per
 *    (date, dimension) pair at the end. `.add()`, not `.put()`, deliberately: today's
 *    date bucket may already have live counts from real concurrent traffic (staging/
 *    production are both already receiving some), and a `.put()` would clobber those
 *    instead of correctly adding to them.
 *
 * Usage: tsx scripts/migration/backfillPageViews.ts [--dry-run] [--resume]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "@/server/prisma";
import { PageView, PageViewDailyStat } from "@/lib/db/opsEntities";

const PAGE_SIZE = 500;
const CHECKPOINT_FILE = ".migration-checkpoint-pageviews.json";
const TTL_SECONDS = 180 * 24 * 60 * 60;

interface Checkpoint {
  cursor: string | null;
  done: boolean;
  rollupDone: boolean;
  rollup: Record<string, number>;
}

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return { cursor: null, done: false, rollupDone: false, rollup: {} };
}

function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

function rollupKey(date: string, dimension: string): string {
  return `${date}|${dimension}`;
}

async function migratePageViews(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.done) {
    console.log("PageViews: already complete, skipping");
    return;
  }

  let cursor = cp.cursor;
  let total = 0;

  while (true) {
    const batch = await prisma.pageView.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        templateId: true,
        domain: true,
        ipHash: true,
        userAgent: true,
        country: true,
        region: true,
        city: true,
        deviceType: true,
        browser: true,
        os: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((v) => ({
      id: v.id,
      templateId: v.templateId,
      domain: v.domain ?? undefined,
      ipHash: v.ipHash ?? undefined,
      userAgent: v.userAgent ?? undefined,
      country: v.country ?? undefined,
      region: v.region ?? undefined,
      city: v.city ?? undefined,
      deviceType: v.deviceType ?? undefined,
      browser: v.browser ?? undefined,
      os: v.os ?? undefined,
      createdAt: v.createdAt.toISOString(),
      ttl: Math.floor(v.createdAt.getTime() / 1000) + TTL_SECONDS,
    }));

    for (const v of batch) {
      const date = v.createdAt.toISOString().slice(0, 10);
      const hour = v.createdAt.getUTCHours();
      const dimensions = [
        "TOTAL",
        `HOUR#${hour}`,
        `DEVICE#${v.deviceType || "Unknown"}`,
        `BROWSER#${v.browser || "Unknown"}`,
        `OS#${v.os || "Unknown"}`,
        `SITE#${v.templateId}`,
      ];
      for (const dimension of dimensions) {
        const key = rollupKey(date, dimension);
        cp.rollup[key] = (cp.rollup[key] ?? 0) + 1;
      }
    }

    if (!dryRun) {
      // ElectroDB batches internally up to DynamoDB's own 25-item BatchWriteItem limit.
      await PageView.put(items).go();
    }

    total += batch.length;
    cursor = batch[batch.length - 1].id;
    cp.cursor = cursor;
    console.log(`PageViews: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.done = true;
  saveCheckpoint(cp);
  console.log(`PageViews: complete, ${total} total.`);
}

async function flushRollup(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.rollupDone) {
    console.log("Rollup: already flushed, skipping");
    return;
  }

  const pairs = Object.entries(cp.rollup);
  console.log(`Rollup: flushing ${pairs.length} distinct (date, dimension) pairs`);

  if (dryRun) {
    console.log("Rollup: dry run, nothing written");
    return;
  }

  // Bounded concurrency — 3,400 rows realistically fold down to a few hundred pairs, but
  // don't fire them all as one Promise.all against DynamoDB regardless.
  const CONCURRENCY = 10;
  let i = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (i < pairs.length) {
      const [key, views] = pairs[i++];
      const [date, dimension] = key.split("|");
      // .update(), not .patch() — see lib/analyticsRollup.ts's own comment on why: .patch()
      // adds an attribute_exists(pk) condition and can never create a new row.
      await PageViewDailyStat.update({ date, dimension }).add({ views }).go();
      done++;
      if (done % 50 === 0) console.log(`Rollup: ${done}/${pairs.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  cp.rollupDone = true;
  saveCheckpoint(cp);
  console.log("Rollup: complete.");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");

  if (!resume && existsSync(CHECKPOINT_FILE)) {
    throw new Error(`${CHECKPOINT_FILE} already exists — pass --resume to continue, or delete it to start fresh.`);
  }

  const cp: Checkpoint = resume ? loadCheckpoint() : { cursor: null, done: false, rollupDone: false, rollup: {} };

  console.log(`Starting PageView backfill (dryRun=${dryRun}, resume=${resume})`);
  await migratePageViews(dryRun, cp);
  await flushRollup(dryRun, cp);
  console.log("Backfill complete.");
}

main()
  .catch((err) => {
    console.error("PageView backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
