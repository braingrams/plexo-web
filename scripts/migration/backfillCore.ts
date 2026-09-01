/**
 * Postgres -> DynamoDB backfill, User + Organization + Member slice.
 *
 * Deliberately not run against production from this session — no DATABASE_URL was
 * ever loaded here, and running a real migration against live customer data is
 * exactly the kind of hard-to-reverse, shared-state action that needs an explicit,
 * present human decision about timing (this is Phase 7/8 territory, gated on real
 * business scheduling, not something to execute autonomously). This establishes the
 * real, working pattern — batched, resumable, idempotent, dry-run capable — for a
 * representative interconnected slice (identity + orgs). The remaining ~58 models
 * across all six tables follow this exact same shape mechanically: read a page from
 * Prisma, map field-for-field to the matching ElectroDB entity (see
 * lib/db/coreEntities.ts / ledgerEntities.ts / commerceEntities.ts / contentEntities.ts
 * / importEntities.ts / opsEntities.ts for the target shapes), batch-write, checkpoint,
 * repeat — not new design for each additional model, just repetition of this pattern.
 *
 * Usage: tsx scripts/migration/backfillCore.ts [--dry-run] [--resume]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "@/server/prisma";
import { User, Organization, Member } from "@/lib/db/coreEntities";

const PAGE_SIZE = 200;
const CHECKPOINT_FILE = ".migration-checkpoint-core.json";

type Checkpoint = { userCursor: string | null; userDone: boolean; orgCursor: string | null; orgDone: boolean };

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return { userCursor: null, userDone: false, orgCursor: null, orgDone: false };
}

function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

async function migrateUsers(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.userDone) {
    console.log("Users: already complete, skipping");
    return;
  }

  let cursor = cp.userCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.user.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        image: true,
        email: true,
        subscriptionPlan: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        allowanceBalance: true,
        topupBalance: true,
        allowanceResetAt: true,
        sellerBalanceCents: true,
        adminRole: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((u) => ({
      id: u.id,
      name: u.name,
      image: u.image ?? undefined,
      email: u.email,
      subscriptionPlan: u.subscriptionPlan,
      stripeCustomerId: u.stripeCustomerId ?? undefined,
      stripeSubscriptionId: u.stripeSubscriptionId ?? undefined,
      allowanceBalance: u.allowanceBalance,
      topupBalance: u.topupBalance,
      allowanceResetAt: u.allowanceResetAt.toISOString(),
      sellerBalanceCents: u.sellerBalanceCents,
      adminRole: u.adminRole ?? undefined,
      createdAt: u.createdAt.toISOString(),
    }));

    if (!dryRun) {
      // ElectroDB batches internally up to DynamoDB's own 25-item BatchWriteItem limit.
      await User.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`Users: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.userCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.userDone = true;
  saveCheckpoint(cp);
  console.log(`Users: complete, ${total} total`);
}

async function migrateOrganizationsAndMembers(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.orgDone) {
    console.log("Organizations: already complete, skipping");
    return;
  }

  let cursor = cp.orgCursor;
  let orgTotal = 0;
  let memberTotal = 0;

  while (true) {
    const batch = await prisma.organization.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: { members: { select: { id: true, userId: true, role: true, createdAt: true } } },
    });

    if (batch.length === 0) break;

    const orgItems = batch.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      logo: o.logo ?? undefined,
      brandColor: o.brandColor ?? undefined,
      whiteLabelEnabled: o.whiteLabelEnabled,
      commerceWalletPooled: o.commerceWalletPooled,
      metadata: o.metadata ?? undefined,
      createdAt: o.createdAt.toISOString(),
    }));

    // Member.role in Prisma is a free-form string (better-auth's own shape) — validated
    // here against the six real OrgRole values accessControl.ts actually defines, since
    // ElectroDB's Member entity types role as that closed enum, not an open string. A
    // row failing this check means real, pre-existing bad data worth surfacing loudly,
    // not silently coercing.
    const VALID_ROLES = new Set(["owner", "admin", "editor", "blogger", "commenter", "viewer"]);
    const memberItems = batch.flatMap((o) =>
      o.members.map((m) => {
        if (!VALID_ROLES.has(m.role)) {
          throw new Error(`Member ${m.id} has unrecognized role "${m.role}" — fix data before continuing migration`);
        }
        return {
          id: m.id,
          organizationId: o.id,
          userId: m.userId,
          role: m.role as "owner" | "admin" | "editor" | "blogger" | "commenter" | "viewer",
          createdAt: m.createdAt.toISOString(),
        };
      }),
    );

    if (!dryRun) {
      await Organization.put(orgItems).go();
      if (memberItems.length > 0) await Member.put(memberItems).go();
    }

    orgTotal += orgItems.length;
    memberTotal += memberItems.length;
    cursor = batch[batch.length - 1].id;
    console.log(`Organizations: ${orgTotal} (${memberTotal} members)${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.orgCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.orgDone = true;
  saveCheckpoint(cp);
  console.log(`Organizations: complete, ${orgTotal} orgs, ${memberTotal} members total`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");

  if (!resume && existsSync(CHECKPOINT_FILE)) {
    throw new Error(
      `${CHECKPOINT_FILE} already exists — pass --resume to continue from it, or delete it to start fresh (only safe if nothing was actually written yet, i.e. a prior --dry-run).`,
    );
  }

  const cp = resume ? loadCheckpoint() : { userCursor: null, userDone: false, orgCursor: null, orgDone: false };

  console.log(`Starting backfill (dryRun=${dryRun}, resume=${resume})`);
  await migrateUsers(dryRun, cp);
  await migrateOrganizationsAndMembers(dryRun, cp);
  console.log("Backfill complete.");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
