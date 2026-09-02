/**
 * Postgres -> DynamoDB backfill, Ledger + Ops + remaining plexo-core slice.
 *
 * Same not-run-here posture as backfillCore.ts: no DATABASE_URL is loaded in this
 * session, this is not executed against production from here, and a human decides
 * real migration timing. This file just extends the established batched/resumable/
 * idempotent/dry-run pattern to ten more models:
 *
 *   CreditLedgerEntry, StripeEvent, PlatformSettings, SellerLedgerEntry,
 *   WithdrawalRequest, AdminAuditLog, FormSubmission, Notification,
 *   NotificationPreferences, UploadedImage
 *
 * Deliberately NOT covered here (per the migration plan): PageView, RateLimit,
 * StockCache — ephemeral/TTL'd operational data that repopulates from live traffic,
 * not worth historically backfilling.
 *
 * These models span three different physical DynamoDB tables even though they're
 * grouped in one script (CreditLedgerEntry/StripeEvent/SellerLedgerEntry/
 * WithdrawalRequest live in plexo-ledger; AdminAuditLog/FormSubmission in plexo-ops;
 * PlatformSettings/Notification/NotificationPreferences/UploadedImage in plexo-core)
 * — table routing is handled entirely inside each ElectroDB entity (see
 * lib/db/ledgerEntities.ts / opsEntities.ts / coreEntities.ts), this script just picks
 * the right entity per model.
 *
 * IMPORTANT — two real ElectroDB limitations surfaced while writing this, not bugs in
 * this script:
 *
 * 1. Every `createdAt` (and WithdrawalRequest's `requestedAt`) below is `readOnly` with
 *    only a `default: () => new Date().toISOString()` — no `set` callback. ElectroDB's
 *    readOnly check only blocks *update/patch*, not the initial create/put (verified by
 *    reading node_modules/electrodb/src/schema.js's checkCreate, which never consults
 *    readOnlyAttributes). So the row's REAL Postgres timestamp CAN be, and is, passed
 *    through on `.put()` here — it is not silently dropped.
 *
 * 2. PlatformSettings.updatedAt is different: it's defined with
 *    `watch: "*", set: () => new Date().toISOString()` (see coreEntities.ts). ElectroDB
 *    unconditionally invokes that `set` callback for every attribute on every write
 *    (`.put()` included — see entity.js's `_makePutParams` -> `applyAttributeSetters`),
 *    and this particular callback ignores whatever value it's handed and always returns
 *    "now". There is no way to make `.put()` preserve a historical updatedAt for this
 *    one field — flagged here and in the migration report, not silently dropped: the
 *    migrated PlatformSettings row will show updatedAt = migration run time, not the
 *    real last-update time from Postgres. Every other field on the row transfers as-is.
 *
 * AdminAuditLog and FormSubmission deliberately never populate a `ttl` value — per
 * opsEntities.ts's own header comment, both are real permanent data (a compliance
 * audit trail; a site owner's actual contact-form leads), unlike PageView/RateLimit/
 * StockCache. Their ElectroDB entity definitions have no `ttl` attribute at all, so
 * there's nothing to populate here — this script simply never references one.
 *
 * Usage: tsx scripts/migration/backfillLedgerOps.ts [--dry-run] [--resume]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "@/server/prisma";
import { CreditLedgerEntry, StripeEvent, SellerLedgerEntry, WithdrawalRequest } from "@/lib/db/ledgerEntities";
import { AdminAuditLog, FormSubmission } from "@/lib/db/opsEntities";
import { PlatformSettings, Notification, NotificationPreferences, UploadedImage } from "@/lib/db/coreEntities";

const PAGE_SIZE = 200;
const CHECKPOINT_FILE = ".migration-checkpoint-ledger-ops.json";

type Checkpoint = {
  creditLedgerCursor: string | null;
  creditLedgerDone: boolean;
  stripeEventCursor: string | null;
  stripeEventDone: boolean;
  platformSettingsDone: boolean;
  sellerLedgerCursor: string | null;
  sellerLedgerDone: boolean;
  withdrawalCursor: string | null;
  withdrawalDone: boolean;
  adminAuditLogCursor: string | null;
  adminAuditLogDone: boolean;
  formSubmissionCursor: string | null;
  formSubmissionDone: boolean;
  notificationCursor: string | null;
  notificationDone: boolean;
  notificationPrefsCursor: string | null;
  notificationPrefsDone: boolean;
  uploadedImageCursor: string | null;
  uploadedImageDone: boolean;
};

function emptyCheckpoint(): Checkpoint {
  return {
    creditLedgerCursor: null,
    creditLedgerDone: false,
    stripeEventCursor: null,
    stripeEventDone: false,
    platformSettingsDone: false,
    sellerLedgerCursor: null,
    sellerLedgerDone: false,
    withdrawalCursor: null,
    withdrawalDone: false,
    adminAuditLogCursor: null,
    adminAuditLogDone: false,
    formSubmissionCursor: null,
    formSubmissionDone: false,
    notificationCursor: null,
    notificationDone: false,
    notificationPrefsCursor: null,
    notificationPrefsDone: false,
    uploadedImageCursor: null,
    uploadedImageDone: false,
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

async function migrateCreditLedgerEntries(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.creditLedgerDone) {
    console.log("CreditLedgerEntry: already complete, skipping");
    return;
  }

  let cursor = cp.creditLedgerCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.creditLedgerEntry.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        type: true,
        amount: true,
        balanceAfter: true,
        description: true,
        stripeEventId: true,
        metadata: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((c) => ({
      id: c.id,
      userId: c.userId,
      type: c.type,
      amount: c.amount,
      balanceAfter: c.balanceAfter,
      description: c.description ?? undefined,
      stripeEventId: c.stripeEventId ?? undefined,
      metadata: c.metadata ?? undefined,
      createdAt: c.createdAt.toISOString(),
    }));

    if (!dryRun) {
      await CreditLedgerEntry.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CreditLedgerEntry: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.creditLedgerCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.creditLedgerDone = true;
  saveCheckpoint(cp);
  console.log(`CreditLedgerEntry: complete, ${total} total`);
}

async function migrateStripeEvents(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.stripeEventDone) {
    console.log("StripeEvent: already complete, skipping");
    return;
  }

  // StripeEvent.id is Stripe's own raw event id (a string, not a uuid) — order by it
  // directly, same cursor-pagination shape as every other model here.
  let cursor = cp.stripeEventCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.stripeEvent.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, createdAt: true },
    });

    if (batch.length === 0) break;

    const items = batch.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
    }));

    if (!dryRun) {
      await StripeEvent.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`StripeEvent: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.stripeEventCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.stripeEventDone = true;
  saveCheckpoint(cp);
  console.log(`StripeEvent: complete, ${total} total`);
}

async function migratePlatformSettings(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.platformSettingsDone) {
    console.log("PlatformSettings: already complete, skipping");
    return;
  }

  // Singleton row (Prisma: id @default("global")) — no pagination needed, at most one row.
  const row = await prisma.platformSettings.findUnique({ where: { id: "global" } });

  if (row) {
    const item = {
      id: row.id,
      autoPublishMarketplaceListings: row.autoPublishMarketplaceListings,
      marketplaceFeeBps: row.marketplaceFeeBps,
      commercePlatformFeeBps: row.commercePlatformFeeBps,
      // updatedAt deliberately NOT passed — see file header: ElectroDB's `set` callback
      // on this attribute unconditionally overwrites to "now" on every write, so passing
      // row.updatedAt here would be silently discarded anyway. Flagged, not hidden.
    };

    if (!dryRun) {
      await PlatformSettings.put(item).go();
    }
    console.log(`PlatformSettings: migrated 1 row${dryRun ? " (dry run)" : ""}`);
  } else {
    console.log("PlatformSettings: no row found in Postgres, nothing to migrate");
  }

  cp.platformSettingsDone = true;
  saveCheckpoint(cp);
}

async function migrateSellerLedgerEntries(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.sellerLedgerDone) {
    console.log("SellerLedgerEntry: already complete, skipping");
    return;
  }

  let cursor = cp.sellerLedgerCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.sellerLedgerEntry.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        type: true,
        grossAmountCents: true,
        feeCents: true,
        netAmountCents: true,
        balanceAfterCents: true,
        templatePurchaseId: true,
        withdrawalRequestId: true,
        description: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((s) => ({
      id: s.id,
      userId: s.userId,
      type: s.type,
      grossAmountCents: s.grossAmountCents ?? undefined,
      feeCents: s.feeCents ?? undefined,
      netAmountCents: s.netAmountCents,
      balanceAfterCents: s.balanceAfterCents,
      templatePurchaseId: s.templatePurchaseId ?? undefined,
      withdrawalRequestId: s.withdrawalRequestId ?? undefined,
      description: s.description ?? undefined,
      createdAt: s.createdAt.toISOString(),
    }));

    if (!dryRun) {
      await SellerLedgerEntry.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`SellerLedgerEntry: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.sellerLedgerCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.sellerLedgerDone = true;
  saveCheckpoint(cp);
  console.log(`SellerLedgerEntry: complete, ${total} total`);
}

async function migrateWithdrawalRequests(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.withdrawalDone) {
    console.log("WithdrawalRequest: already complete, skipping");
    return;
  }

  let cursor = cp.withdrawalCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.withdrawalRequest.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        amountCents: true,
        encryptedAccountNumber: true,
        encryptedAccountHolderName: true,
        bankName: true,
        status: true,
        rejectionReason: true,
        requestedAt: true,
        processedAt: true,
        processedByAdminId: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((w) => ({
      id: w.id,
      userId: w.userId,
      amountCents: w.amountCents,
      // Already encrypted at rest (lib/crypto.ts) — carried over verbatim, never
      // decrypted/re-encrypted by this script.
      encryptedAccountNumber: w.encryptedAccountNumber,
      encryptedAccountHolderName: w.encryptedAccountHolderName,
      bankName: w.bankName,
      status: w.status,
      rejectionReason: w.rejectionReason ?? undefined,
      requestedAt: w.requestedAt.toISOString(),
      processedAt: w.processedAt?.toISOString() ?? undefined,
      processedByAdminId: w.processedByAdminId ?? undefined,
    }));

    if (!dryRun) {
      await WithdrawalRequest.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`WithdrawalRequest: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.withdrawalCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.withdrawalDone = true;
  saveCheckpoint(cp);
  console.log(`WithdrawalRequest: complete, ${total} total`);
}

async function migrateAdminAuditLogs(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.adminAuditLogDone) {
    console.log("AdminAuditLog: already complete, skipping");
    return;
  }

  let cursor = cp.adminAuditLogCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.adminAuditLog.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        actorId: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((a) => ({
      id: a.id,
      actorId: a.actorId,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      metadata: a.metadata ?? undefined,
      createdAt: a.createdAt.toISOString(),
      // No `ttl` field — AdminAuditLog is a permanent compliance trail (see file header
      // and opsEntities.ts). This entity's schema has no ttl attribute at all.
    }));

    if (!dryRun) {
      await AdminAuditLog.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`AdminAuditLog: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.adminAuditLogCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.adminAuditLogDone = true;
  saveCheckpoint(cp);
  console.log(`AdminAuditLog: complete, ${total} total`);
}

async function migrateFormSubmissions(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.formSubmissionDone) {
    console.log("FormSubmission: already complete, skipping");
    return;
  }

  let cursor = cp.formSubmissionCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.formSubmission.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        templateId: true,
        organizationId: true,
        formName: true,
        fields: true,
        submitterIp: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((f) => ({
      id: f.id,
      templateId: f.templateId,
      organizationId: f.organizationId,
      formName: f.formName,
      fields: f.fields,
      submitterIp: f.submitterIp ?? undefined,
      createdAt: f.createdAt.toISOString(),
      // No `ttl` field — a site owner's real contact-form leads, not disposable
      // operational data (see file header and opsEntities.ts). No ttl attribute exists
      // on this entity's schema.
    }));

    if (!dryRun) {
      await FormSubmission.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`FormSubmission: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.formSubmissionCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.formSubmissionDone = true;
  saveCheckpoint(cp);
  console.log(`FormSubmission: complete, ${total} total`);
}

async function migrateNotifications(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.notificationDone) {
    console.log("Notification: already complete, skipping");
    return;
  }

  let cursor = cp.notificationCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.notification.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        type: true,
        actorId: true,
        commentId: true,
        templateId: true,
        readAt: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((n) => ({
      id: n.id,
      organizationId: n.organizationId,
      userId: n.userId,
      type: n.type,
      actorId: n.actorId ?? undefined,
      commentId: n.commentId ?? undefined,
      templateId: n.templateId ?? undefined,
      readAt: n.readAt?.toISOString() ?? undefined,
      createdAt: n.createdAt.toISOString(),
    }));

    if (!dryRun) {
      await Notification.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`Notification: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.notificationCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.notificationDone = true;
  saveCheckpoint(cp);
  console.log(`Notification: complete, ${total} total`);
}

async function migrateNotificationPreferences(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.notificationPrefsDone) {
    console.log("NotificationPreferences: already complete, skipping");
    return;
  }

  let cursor = cp.notificationPrefsCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.notificationPreferences.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        organizationId: true,
        formSubmissions: true,
        blogComments: true,
        payments: true,
        commentMentions: true,
        notificationEmail: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((p) => ({
      id: p.id,
      organizationId: p.organizationId,
      formSubmissions: p.formSubmissions,
      blogComments: p.blogComments,
      payments: p.payments,
      commentMentions: p.commentMentions,
      notificationEmail: p.notificationEmail ?? undefined,
    }));

    if (!dryRun) {
      await NotificationPreferences.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`NotificationPreferences: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.notificationPrefsCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.notificationPrefsDone = true;
  saveCheckpoint(cp);
  console.log(`NotificationPreferences: complete, ${total} total`);
}

async function migrateUploadedImages(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.uploadedImageDone) {
    console.log("UploadedImage: already complete, skipping");
    return;
  }

  let cursor = cp.uploadedImageCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.uploadedImage.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        name: true,
        url: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((img) => ({
      id: img.id,
      userId: img.userId,
      organizationId: img.organizationId,
      name: img.name,
      url: img.url,
      createdAt: img.createdAt.toISOString(),
    }));

    if (!dryRun) {
      await UploadedImage.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`UploadedImage: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.uploadedImageCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.uploadedImageDone = true;
  saveCheckpoint(cp);
  console.log(`UploadedImage: complete, ${total} total`);
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

  console.log(`Starting ledger/ops backfill (dryRun=${dryRun}, resume=${resume})`);
  await migrateCreditLedgerEntries(dryRun, cp);
  await migrateStripeEvents(dryRun, cp);
  await migratePlatformSettings(dryRun, cp);
  await migrateSellerLedgerEntries(dryRun, cp);
  await migrateWithdrawalRequests(dryRun, cp);
  await migrateAdminAuditLogs(dryRun, cp);
  await migrateFormSubmissions(dryRun, cp);
  await migrateNotifications(dryRun, cp);
  await migrateNotificationPreferences(dryRun, cp);
  await migrateUploadedImages(dryRun, cp);
  console.log("Ledger/ops backfill complete.");
}

main()
  .catch((err) => {
    console.error("Ledger/ops backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
