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
 * Extended to also cover ApiKey and Invitation (still identity/access-control-adjacent,
 * same plexo-core table) — same mechanical pattern as User/Organization/Member below.
 *
 * Usage: tsx scripts/migration/backfillCore.ts [--dry-run] [--resume]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "@/server/prisma";
import { User, Organization, Member, ApiKey, Invitation } from "@/lib/db/coreEntities";

const PAGE_SIZE = 200;
const CHECKPOINT_FILE = ".migration-checkpoint-core.json";

// Member.role and Invitation.role are both plain strings in Prisma (better-auth's own
// shape, see schema.prisma comment on Organization) validated here against the six real
// OrgRole values accessControl.ts actually defines, since ElectroDB's Member/Invitation
// entities both type role as that closed enum, not an open string. A row failing this
// check means real, pre-existing bad data worth surfacing loudly, not silently coercing.
const VALID_ROLES = new Set(["owner", "admin", "editor", "blogger", "commenter", "viewer"]);

type Checkpoint = {
  userCursor: string | null;
  userDone: boolean;
  orgCursor: string | null;
  orgDone: boolean;
  apiKeyCursor: string | null;
  apiKeyDone: boolean;
  invitationCursor: string | null;
  invitationDone: boolean;
};

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return {
    userCursor: null,
    userDone: false,
    orgCursor: null,
    orgDone: false,
    apiKeyCursor: null,
    apiKeyDone: false,
    invitationCursor: null,
    invitationDone: false,
  };
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
        // Auth.js Credentials-provider fields (server/authDynamo.ts, added this same
        // session) — isConfirmed/suspendedAt/suspendedReason live directly on Prisma's
        // User. passwordHash does NOT: `User.passwordHash` is a dead, always-`""` column
        // (confirmed via a direct query — every real account has it empty); better-auth
        // actually stored the real credential hash on the separate Account row where
        // providerId = "credential" (Account.password), which this join reads instead.
        // Omitting this would migrate every real account into a state where the new
        // email/password login could never succeed (every passwordHash empty).
        isConfirmed: true,
        suspendedAt: true,
        suspendedReason: true,
        accounts: { where: { providerId: "credential" }, select: { password: true }, take: 1 },
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
      passwordHash: u.accounts[0]?.password ?? "",
      isConfirmed: u.isConfirmed,
      suspendedAt: u.suspendedAt?.toISOString() ?? undefined,
      suspendedReason: u.suspendedReason ?? undefined,
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

async function migrateApiKeys(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.apiKeyDone) {
    console.log("ApiKeys: already complete, skipping");
    return;
  }

  let cursor = cp.apiKeyCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.apiKey.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        name: true,
        hashedKey: true,
        maskedKey: true,
        useAi: true,
        aiProvider: true,
        aiTier: true,
        aiApiKey: true,
        isActive: true,
        aiAccessMode: true,
        hostAuthWebhookUrl: true,
        hostWebhookSecret: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((k) => ({
      id: k.id,
      userId: k.userId,
      organizationId: k.organizationId,
      name: k.name,
      // hashedKey/maskedKey carried over verbatim — this is already-hashed/masked data,
      // never re-derived or re-hashed here (see ApiKey's byHashedKey GSI2 in coreEntities.ts).
      hashedKey: k.hashedKey,
      maskedKey: k.maskedKey,
      useAi: k.useAi,
      aiProvider: k.aiProvider,
      aiTier: k.aiTier,
      // aiApiKey/hostWebhookSecret are already ciphertext at rest (lib/crypto.ts) —
      // transferred verbatim, never decrypted/re-encrypted by this script.
      aiApiKey: k.aiApiKey ?? undefined,
      isActive: k.isActive,
      aiAccessMode: k.aiAccessMode,
      hostAuthWebhookUrl: k.hostAuthWebhookUrl ?? undefined,
      hostWebhookSecret: k.hostWebhookSecret ?? undefined,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? undefined,
    }));

    if (!dryRun) {
      await ApiKey.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`ApiKeys: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.apiKeyCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.apiKeyDone = true;
  saveCheckpoint(cp);
  console.log(`ApiKeys: complete, ${total} total`);
}

async function migrateInvitations(dryRun: boolean, cp: Checkpoint): Promise<void> {
  if (cp.invitationDone) {
    console.log("Invitations: already complete, skipping");
    return;
  }

  // Invitation.status is a free-form string in Prisma (default "pending") — validated
  // here against the four values ElectroDB's Invitation entity actually accepts, same
  // "surface bad data loudly, don't coerce" discipline as VALID_ROLES above.
  const VALID_STATUSES = new Set(["pending", "accepted", "rejected", "canceled"]);

  let cursor = cp.invitationCursor;
  let total = 0;

  while (true) {
    const batch = await prisma.invitation.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        organizationId: true,
        email: true,
        role: true,
        status: true,
        inviterId: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    const items = batch.map((inv) => {
      if (!VALID_ROLES.has(inv.role)) {
        throw new Error(`Invitation ${inv.id} has unrecognized role "${inv.role}" — fix data before continuing migration`);
      }
      if (!VALID_STATUSES.has(inv.status)) {
        throw new Error(`Invitation ${inv.id} has unrecognized status "${inv.status}" — fix data before continuing migration`);
      }
      return {
        id: inv.id,
        organizationId: inv.organizationId,
        email: inv.email,
        role: inv.role as "owner" | "admin" | "editor" | "blogger" | "commenter" | "viewer",
        status: inv.status as "pending" | "accepted" | "rejected" | "canceled",
        inviterId: inv.inviterId,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
      };
    });

    if (!dryRun) {
      await Invitation.put(items).go();
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`Invitations: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    cp.invitationCursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  cp.invitationDone = true;
  saveCheckpoint(cp);
  console.log(`Invitations: complete, ${total} total`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");

  if (!resume && existsSync(CHECKPOINT_FILE)) {
    throw new Error(
      `${CHECKPOINT_FILE} already exists — pass --resume to continue from it, or delete it to start fresh (only safe if nothing was actually written yet, i.e. a prior --dry-run).`,
    );
  }

  const cp = resume
    ? loadCheckpoint()
    : {
        userCursor: null,
        userDone: false,
        orgCursor: null,
        orgDone: false,
        apiKeyCursor: null,
        apiKeyDone: false,
        invitationCursor: null,
        invitationDone: false,
      };

  console.log(`Starting backfill (dryRun=${dryRun}, resume=${resume})`);
  await migrateUsers(dryRun, cp);
  await migrateOrganizationsAndMembers(dryRun, cp);
  await migrateApiKeys(dryRun, cp);
  await migrateInvitations(dryRun, cp);
  console.log("Backfill complete.");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
