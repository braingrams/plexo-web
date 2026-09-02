/**
 * One-off repair: restores the real historical `updatedAt` for every row the original
 * Postgres -> DynamoDB migration wrote, across every entity whose `updatedAt` attribute
 * is defined with `watch: "*", set: () => new Date().toISOString()` (see coreEntities.ts /
 * contentEntities.ts / commerceEntities.ts / importEntities.ts).
 *
 * Root cause (confirmed by reading node_modules/electrodb/src/{schema,entity}.js, not
 * guessed): ElectroDB's `set` callback runs unconditionally on every write — `.put()`
 * included — and this one always returns "now" regardless of the value passed in. Every
 * original backfill*.ts script DID select and pass the real Postgres `updatedAt` on
 * `.put()` (confirmed by reading their own item mappers), but ElectroDB silently
 * overwrote it with the migration's own run time on the way in. Symptom: every migrated
 * row appeared "just updated," which is what pushed real historical activity (e.g.
 * domain-connected events from weeks ago) off the dashboard's Recent Activity feed.
 *
 * Fix here bypasses ElectroDB's attribute pipeline entirely for this one field — the
 * same technique backfillAuthUsers.ts already uses for Auth.js's own schema-less
 * records, just applied here to sidestep one specific attribute's `set` callback rather
 * than ElectroDB altogether. `entity.get(facets).params()` derives the exact
 * `{TableName, Key}` DynamoDB would use for that row (so this file never hand-duplicates
 * any entity's real pk/sk template), then a raw docClient.update() SETs only
 * `updatedAt`, which ElectroDB's own machinery never touches this way.
 *
 * Every entity below already has its row present in DynamoDB from the original
 * migration — this never creates a row, only corrects one field on an existing one. If a
 * row is somehow missing, update() naturally creates a bare item with just pk/sk/
 * updatedAt; harmless (real data still lives at PATCH-1_time) but flagged via a warning.
 *
 * Usage: tsx scripts/migration/fixMigratedUpdatedAt.ts [--dry-run] [--resume]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "@/server/prisma";
import { docClient, TABLES } from "@/lib/db/client";
import { PlatformSettings } from "@/lib/db/coreEntities";
import {
  Template,
  PublishedDomain,
  BlogSite,
  SiteLayout,
  BlogAuthor,
  BlogPost,
  Testimonial,
  TemplateGenerationJob,
  Comment,
} from "@/lib/db/contentEntities";
import {
  CommerceCategory,
  CommerceProduct,
  CommerceCart,
  CommerceCartItem,
  CommerceOrder,
  CommerceBooking,
  CommerceDiscountCode,
  CommerceProductReview,
  CommerceSettings,
  CommerceWallet,
} from "@/lib/db/commerceEntities";
import { ImportJob, SiteImportJob, SiteImportPage } from "@/lib/db/importEntities";

const PAGE_SIZE = 200;
const CHECKPOINT_FILE = ".migration-checkpoint-fix-updatedat.json";

interface JobDef {
  label: string;
  // ElectroDB's real Entity<...> generic type doesn't collapse to one structural shape
  // across entities with different attributes — every entity below genuinely has a
  // `.get(facets).params()` method with the shape used in runJob, `any` just avoids
  // fighting the generic for what's a one-off internal script, not library code.
  entity: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  tableName: string;
  // Every field this job's Prisma select needs beyond `id` and `updatedAt`.
  extraFields: string[];
  // Override for a facet that isn't a direct column — CommerceCartItem's templateId
  // only exists via its cart relation, not on the row itself.
  extraSelect?: Record<string, unknown>;
  toFacets: (row: Record<string, unknown>) => Record<string, unknown>;
}

const jobs: JobDef[] = [
  { label: "Template", entity: Template, tableName: TABLES.content, extraFields: [], toFacets: (r) => ({ id: r.id }) },
  { label: "PublishedDomain", entity: PublishedDomain, tableName: TABLES.content, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId, id: r.id }) },
  { label: "BlogSite", entity: BlogSite, tableName: TABLES.content, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId }) },
  { label: "SiteLayout", entity: SiteLayout, tableName: TABLES.content, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId }) },
  { label: "BlogAuthor", entity: BlogAuthor, tableName: TABLES.content, extraFields: ["templateId", "slug"], toFacets: (r) => ({ templateId: r.templateId, slug: r.slug }) },
  { label: "BlogPost", entity: BlogPost, tableName: TABLES.content, extraFields: ["templateId", "slug"], toFacets: (r) => ({ templateId: r.templateId, slug: r.slug }) },
  { label: "Testimonial", entity: Testimonial, tableName: TABLES.content, extraFields: [], toFacets: (r) => ({ id: r.id }) },
  { label: "TemplateGenerationJob", entity: TemplateGenerationJob, tableName: TABLES.content, extraFields: [], toFacets: (r) => ({ id: r.id }) },
  {
    label: "Comment",
    entity: Comment,
    tableName: TABLES.content,
    extraFields: ["templateId", "createdAt"],
    toFacets: (r) => ({ templateId: r.templateId, createdAt: (r.createdAt as Date).toISOString(), id: r.id }),
  },
  { label: "CommerceCategory", entity: CommerceCategory, tableName: TABLES.commerce, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId, id: r.id }) },
  { label: "CommerceProduct", entity: CommerceProduct, tableName: TABLES.commerce, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId, id: r.id }) },
  { label: "CommerceCart", entity: CommerceCart, tableName: TABLES.commerce, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId, id: r.id }) },
  {
    label: "CommerceCartItem",
    entity: CommerceCartItem,
    tableName: TABLES.commerce,
    extraFields: ["cartId"],
    extraSelect: { cart: { select: { templateId: true } } },
    toFacets: (r) => ({ templateId: (r.cart as { templateId: string }).templateId, cartId: r.cartId, id: r.id }),
  },
  { label: "CommerceOrder", entity: CommerceOrder, tableName: TABLES.commerce, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId, id: r.id }) },
  { label: "CommerceBooking", entity: CommerceBooking, tableName: TABLES.commerce, extraFields: ["templateId", "orderId"], toFacets: (r) => ({ templateId: r.templateId, orderId: r.orderId }) },
  { label: "CommerceDiscountCode", entity: CommerceDiscountCode, tableName: TABLES.commerce, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId, id: r.id }) },
  { label: "CommerceProductReview", entity: CommerceProductReview, tableName: TABLES.commerce, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId, id: r.id }) },
  { label: "CommerceSettings", entity: CommerceSettings, tableName: TABLES.commerce, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId }) },
  {
    label: "CommerceWallet",
    entity: CommerceWallet,
    tableName: TABLES.commerce,
    extraFields: ["templateId", "organizationId"],
    toFacets: (r) => ({ scopeId: (r.templateId as string | null) ?? (r.organizationId as string) }),
  },
  { label: "ImportJob", entity: ImportJob, tableName: TABLES.import, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId, id: r.id }) },
  { label: "SiteImportJob", entity: SiteImportJob, tableName: TABLES.import, extraFields: ["templateId"], toFacets: (r) => ({ templateId: r.templateId, id: r.id }) },
  {
    label: "SiteImportPage",
    entity: SiteImportPage,
    tableName: TABLES.import,
    extraFields: ["jobId", "sourceUrl"],
    toFacets: (r) => ({ jobId: r.jobId, sourceUrl: r.sourceUrl }),
  },
];

// PlatformSettings is a global singleton with no composite facets at all — handled
// separately below rather than forced into the per-row pagination shape above.

interface Checkpoint {
  [label: string]: { cursor: string | null; done: boolean };
}

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  return {};
}
function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// Prisma model accessor name = entity label with the first letter lowercased — matches
// every model in schema.prisma (verified: Template -> prisma.template, CommerceWallet ->
// prisma.commerceWallet, etc.), so this is derived rather than hand-listed per job.
function prismaModel(label: string): any {
  const key = label.charAt(0).toLowerCase() + label.slice(1);
  return (prisma as unknown as Record<string, any>)[key];
}

async function runJob(job: JobDef, dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp[job.label] ?? { cursor: null, done: false };
  cp[job.label] = state;
  if (state.done) {
    console.log(`${job.label}: already complete, skipping`);
    return;
  }

  const model = prismaModel(job.label);
  let cursor = state.cursor;
  let total = 0;

  while (true) {
    const batch: Array<Record<string, unknown>> = await model.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        ...Object.fromEntries([["id", true], ["updatedAt", true], ...job.extraFields.map((f) => [f, true])]),
        ...job.extraSelect,
      },
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      const facets = job.toFacets(row);
      const updatedAtIso = (row.updatedAt as Date).toISOString();
      if (!dryRun) {
        // Some source rows were deliberately never migrated (e.g. the one known-bad
        // CommerceWallet row, org 9a80f052-.../wallet dfbe0d15-... — see
        // backfillCommerce.ts's own skip log) — a raw UpdateItem SET on a pk/sk that was
        // never written would silently CREATE a bare, malformed placeholder item instead
        // of erroring, undoing that deliberate skip. Guard with an existence check first.
        const { data: existing } = await job.entity.get(facets).go();
        if (!existing) {
          console.warn(`${job.label}: SKIPPING ${JSON.stringify(facets)} — no matching row in DynamoDB (never migrated, or already deleted).`);
          continue;
        }
        const { TableName, Key } = job.entity.get(facets).params();
        await docClient.update({
          TableName,
          Key,
          UpdateExpression: "SET updatedAt = :u",
          ExpressionAttributeValues: { ":u": updatedAtIso },
        });
      }
    }

    total += batch.length;
    cursor = batch[batch.length - 1].id as string;
    state.cursor = cursor;
    console.log(`${job.label}: ${total} fixed${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  state.done = true;
  saveCheckpoint(cp);
  console.log(`${job.label}: complete, ${total} total`);
}

async function fixPlatformSettings(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const label = "PlatformSettings";
  if (cp[label]?.done) {
    console.log(`${label}: already complete, skipping`);
    return;
  }
  const row = await prisma.platformSettings.findUnique({ where: { id: "global" }, select: { updatedAt: true } });
  if (row) {
    const updatedAtIso = row.updatedAt.toISOString();
    if (!dryRun) {
      const { data: existing } = await PlatformSettings.get({}).go();
      if (!existing) {
        console.warn(`${label}: SKIPPING — no matching row in DynamoDB.`);
        cp[label] = { cursor: null, done: true };
        saveCheckpoint(cp);
        return;
      }
      const { TableName, Key } = PlatformSettings.get({}).params();
      await docClient.update({ TableName, Key, UpdateExpression: "SET updatedAt = :u", ExpressionAttributeValues: { ":u": updatedAtIso } });
    }
    console.log(`${label}: fixed${dryRun ? " (dry run)" : ""}`);
  } else {
    console.log(`${label}: no row in Postgres, skipping`);
  }
  cp[label] = { cursor: null, done: true };
  saveCheckpoint(cp);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");

  if (!resume && existsSync(CHECKPOINT_FILE)) {
    throw new Error(`${CHECKPOINT_FILE} already exists — pass --resume to continue, or delete it to start fresh.`);
  }

  const cp = resume ? loadCheckpoint() : {};

  console.log(`Starting updatedAt repair (dryRun=${dryRun}, resume=${resume})`);
  for (const job of jobs) {
    await runJob(job, dryRun, cp);
  }
  await fixPlatformSettings(dryRun, cp);
  console.log("Repair complete.");
}

main()
  .catch((err) => {
    console.error("updatedAt repair failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
