/**
 * Postgres -> DynamoDB backfill, Import slice: ImportJob, ImportMediaMap, SiteImportJob,
 * SiteImportPage, SiteImportAssetBlob.
 *
 * Same not-run-here posture as backfillCore.ts: no DATABASE_URL is loaded in this
 * session, this is not executed against production from here, and a human decides real
 * migration timing.
 *
 * NOTE on SiteImportJob/SiteImportPage/SiteImportAssetBlob: as of this writing these
 * have 0 rows in the real database (confirmed with the person who assigned this task).
 * The migration logic below is still written and type-checked correctly — a future dev
 * may create rows before this script actually runs — but volume/precision for these
 * three doesn't matter much in practice today.
 *
 * IMPORTANT — TTL semantics: every entity in this table (see lib/db/importEntities.ts)
 * defaults `ttl` to "90 days from whenever `.put()`/`.create()` runs" via a plain
 * (non-readOnly, no `set` callback) default function. If we let that default apply
 * during migration, every already-old, long-finished import job would get an
 * artificially fresh 90-day lease starting at migration time — wrong: the entity's own
 * design intent is "self-clean 90 days after creation." So every ttl below is instead
 * computed explicitly from the row's REAL Postgres createdAt + 90 days. A genuinely old
 * completed job can end up with a ttl already in the past — that's correct: DynamoDB
 * will delete it shortly after this write, which is exactly what should have already
 * happened had this data lived in DynamoDB from the start.
 *
 * IMPORTANT — updatedAt limitation: ImportJob.updatedAt, SiteImportJob.updatedAt, and
 * SiteImportPage.updatedAt are all defined with `watch: "*", set: () => new
 * Date().toISOString()` (see importEntities.ts). ElectroDB unconditionally invokes that
 * `set` callback on every write, including `.put()` (verified by reading
 * node_modules/electrodb/src/entity.js's `_makePutParams` -> `applyAttributeSetters`),
 * and the callback ignores whatever value it's handed and always returns "now". There is
 * no way to make `.put()` preserve a real historical updatedAt for these three fields —
 * flagged here and in the migration report, not silently dropped. Every other field,
 * including the plain `readOnly`+`default`-only `createdAt` (and SiteImportAssetBlob's,
 * which has no updatedAt/set field at all), transfers with its real historical value —
 * readOnly alone does NOT block `.put()`/`.create()` (checkCreate in
 * node_modules/electrodb/src/schema.js never consults readOnlyAttributes).
 *
 * Usage: tsx scripts/migration/backfillImport.ts [--dry-run] [--resume]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "@/server/prisma";
import { ImportJob, ImportMediaMap, SiteImportJob, SiteImportPage, SiteImportAssetBlob } from "@/lib/db/importEntities";

const PAGE_SIZE = 200;
const CHECKPOINT_FILE = ".migration-checkpoint-import.json";

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;
const ttlFromCreatedAt = (createdAt: Date): number => Math.floor(createdAt.getTime() / 1000) + NINETY_DAYS_SECONDS;

type Checkpoint = {
  importJobCursor: string | null;
  importJobDone: boolean;
  importMediaMapCursor: string | null;
  importMediaMapDone: boolean;
  siteImportJobCursor: string | null;
  siteImportJobDone: boolean;
  siteImportPageCursor: string | null;
  siteImportPageDone: boolean;
  siteImportAssetBlobCursor: string | null;
  siteImportAssetBlobDone: boolean;
};

function emptyCheckpoint(): Checkpoint {
  return {
    importJobCursor: null,
    importJobDone: false,
    importMediaMapCursor: null,
    importMediaMapDone: false,
    siteImportJobCursor: null,
    siteImportJobDone: false,
    siteImportPageCursor: null,
    siteImportPageDone: false,
    siteImportAssetBlobCursor: null,
    siteImportAssetBlobDone: false,
  };
}

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return emptyCheckpoint();
}

function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

async function migrateImportJobs(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.importJobDone) {
    console.log("ImportJob: already complete, skipping");
    return;
  }

  let cursor = cp.importJobCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.importJob.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        templateId: true,
        sourceType: true,
        sourceUrl: true,
        wxrBlobUrl: true,
        status: true,
        mediaHandling: true,
        processing: true,
        cursor: true,
        totalPosts: true,
        processedPosts: true,
        totalMedia: true,
        processedMedia: true,
        errors: true,
        lastHeartbeatAt: true,
        createdBy: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((j) => ({
      id: j.id,
      templateId: j.templateId,
      sourceType: j.sourceType,
      sourceUrl: j.sourceUrl ?? undefined,
      wxrBlobUrl: j.wxrBlobUrl ?? undefined,
      status: j.status,
      mediaHandling: j.mediaHandling,
      processing: j.processing,
      cursor: j.cursor ?? undefined,
      totalPosts: j.totalPosts ?? undefined,
      processedPosts: j.processedPosts,
      totalMedia: j.totalMedia ?? undefined,
      processedMedia: j.processedMedia,
      errors: j.errors ?? undefined,
      lastHeartbeatAt: j.lastHeartbeatAt?.toISOString() ?? undefined,
      createdBy: j.createdBy ?? undefined,
      startedAt: j.startedAt?.toISOString() ?? undefined,
      finishedAt: j.finishedAt?.toISOString() ?? undefined,
      createdAt: j.createdAt.toISOString(),
      // updatedAt intentionally omitted — see file header, it's always overwritten to
      // "now" by the entity's own `set` callback regardless of what's passed.
      ttl: ttlFromCreatedAt(j.createdAt),
    }));

    if (!dryRun) {
      await ImportJob.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`ImportJob: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.importJobCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.importJobDone = true;
  saveCheckpoint(cp);
  console.log(`ImportJob: complete, ${total} total`);
}

async function migrateImportMediaMaps(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.importMediaMapDone) {
    console.log("ImportMediaMap: already complete, skipping");
    return;
  }

  let cursor = cp.importMediaMapCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.importMediaMap.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        templateId: true,
        sourceUrl: true,
        blobUrl: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((m) => ({
      id: m.id,
      templateId: m.templateId,
      sourceUrl: m.sourceUrl,
      blobUrl: m.blobUrl,
      createdAt: m.createdAt.toISOString(),
      ttl: ttlFromCreatedAt(m.createdAt),
    }));

    if (!dryRun) {
      await ImportMediaMap.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`ImportMediaMap: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.importMediaMapCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.importMediaMapDone = true;
  saveCheckpoint(cp);
  console.log(`ImportMediaMap: complete, ${total} total`);
}

async function migrateSiteImportJobs(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.siteImportJobDone) {
    console.log("SiteImportJob: already complete, skipping");
    return;
  }

  let cursor = cp.siteImportJobCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.siteImportJob.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        templateId: true,
        organizationId: true,
        sourceUrl: true,
        platform: true,
        importBlogPosts: true,
        mediaHandling: true,
        phase: true,
        processing: true,
        lastHeartbeatAt: true,
        ownershipAttestedAt: true,
        ownershipAttestedBy: true,
        urlMap: true,
        totalPages: true,
        processedPages: true,
        totalAssets: true,
        processedAssets: true,
        errors: true,
        warnings: true,
        createdBy: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((j) => ({
      id: j.id,
      templateId: j.templateId,
      organizationId: j.organizationId,
      sourceUrl: j.sourceUrl,
      platform: j.platform,
      importBlogPosts: j.importBlogPosts,
      mediaHandling: j.mediaHandling,
      phase: j.phase,
      processing: j.processing,
      lastHeartbeatAt: j.lastHeartbeatAt?.toISOString() ?? undefined,
      ownershipAttestedAt: j.ownershipAttestedAt?.toISOString() ?? undefined,
      ownershipAttestedBy: j.ownershipAttestedBy ?? undefined,
      urlMap: j.urlMap ?? undefined,
      totalPages: j.totalPages ?? undefined,
      processedPages: j.processedPages,
      totalAssets: j.totalAssets ?? undefined,
      processedAssets: j.processedAssets,
      errors: j.errors ?? undefined,
      warnings: j.warnings ?? undefined,
      createdBy: j.createdBy ?? undefined,
      startedAt: j.startedAt?.toISOString() ?? undefined,
      finishedAt: j.finishedAt?.toISOString() ?? undefined,
      createdAt: j.createdAt.toISOString(),
      // updatedAt intentionally omitted — see file header, always overwritten to "now".
      ttl: ttlFromCreatedAt(j.createdAt),
    }));

    if (!dryRun) {
      await SiteImportJob.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`SiteImportJob: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.siteImportJobCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.siteImportJobDone = true;
  saveCheckpoint(cp);
  console.log(`SiteImportJob: complete, ${total} total`);
}

async function migrateSiteImportPages(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.siteImportPageDone) {
    console.log("SiteImportPage: already complete, skipping");
    return;
  }

  let cursor = cp.siteImportPageCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.siteImportPage.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        jobId: true,
        sourceUrl: true,
        isBlogPost: true,
        outcome: true,
        createdTemplateId: true,
        createdBlogPostId: true,
        usedHeadless: true,
        heuristicExtraction: true,
        interactiveFeatureFlags: true,
        rewrittenAt: true,
        error: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((p) => ({
      id: p.id,
      jobId: p.jobId,
      sourceUrl: p.sourceUrl,
      isBlogPost: p.isBlogPost,
      outcome: p.outcome,
      createdTemplateId: p.createdTemplateId ?? undefined,
      createdBlogPostId: p.createdBlogPostId ?? undefined,
      usedHeadless: p.usedHeadless,
      heuristicExtraction: p.heuristicExtraction,
      interactiveFeatureFlags: p.interactiveFeatureFlags ?? undefined,
      rewrittenAt: p.rewrittenAt?.toISOString() ?? undefined,
      error: p.error ?? undefined,
      createdAt: p.createdAt.toISOString(),
      // updatedAt intentionally omitted — see file header, always overwritten to "now".
      ttl: ttlFromCreatedAt(p.createdAt),
    }));

    if (!dryRun) {
      await SiteImportPage.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`SiteImportPage: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.siteImportPageCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.siteImportPageDone = true;
  saveCheckpoint(cp);
  console.log(`SiteImportPage: complete, ${total} total`);
}

async function migrateSiteImportAssetBlobs(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.siteImportAssetBlobDone) {
    console.log("SiteImportAssetBlob: already complete, skipping");
    return;
  }

  let cursor = cp.siteImportAssetBlobCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.siteImportAssetBlob.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        jobId: true,
        sha256: true,
        blobUrl: true,
        contentType: true,
        size: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((b) => ({
      id: b.id,
      jobId: b.jobId,
      sha256: b.sha256,
      blobUrl: b.blobUrl,
      contentType: b.contentType,
      size: b.size,
      createdAt: b.createdAt.toISOString(),
      ttl: ttlFromCreatedAt(b.createdAt),
    }));

    if (!dryRun) {
      await SiteImportAssetBlob.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`SiteImportAssetBlob: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.siteImportAssetBlobCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.siteImportAssetBlobDone = true;
  saveCheckpoint(cp);
  console.log(`SiteImportAssetBlob: complete, ${total} total`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");

  if (!resume && existsSync(CHECKPOINT_FILE)) {
    throw new Error(
      `${CHECKPOINT_FILE} already exists — pass --resume to continue from it, or delete it to start fresh (only safe if nothing was actually written yet, i.e. a prior --dry-run).`,
    );
  }

  const cp = resume ? loadCheckpoint() : emptyCheckpoint();

  console.log(`Starting import backfill (dryRun=${dryRun}, resume=${resume})`);
  await migrateImportJobs(dryRun, cp);
  await migrateImportMediaMaps(dryRun, cp);
  await migrateSiteImportJobs(dryRun, cp);
  await migrateSiteImportPages(dryRun, cp);
  await migrateSiteImportAssetBlobs(dryRun, cp);
  console.log("Import backfill complete.");
}

main()
  .catch((err) => {
    console.error("Import backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
