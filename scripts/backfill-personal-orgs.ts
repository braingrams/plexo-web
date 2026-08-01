/**
 * One-off migration: gives every existing user (pre-collaboration-feature) their own
 * personal Organization, makes them its "owner" Member, and backfills organizationId
 * onto all their existing Template/ApiKey/PublishedDomain/UploadedImage rows.
 * Safe to re-run — users who already have a Member row are skipped.
 *
 * Usage: npx tsx scripts/backfill-personal-orgs.ts
 */
import "dotenv/config";
import { prisma } from "../server/prisma";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

async function main() {
  const users = await prisma.user.findMany({
    where: { memberships: { none: {} } },
    select: { id: true, name: true },
  });

  console.log(`Found ${users.length} user(s) with no organization.`);

  let migrated = 0;

  for (const user of users) {
    const orgName = `${user.name}'s Workspace`;
    const baseSlug = slugify(user.name);

    await prisma.$transaction(async (tx) => {
      let organization;
      let attempt = 0;
      // Retry with a different suffix on the astronomically unlikely slug collision.
      while (!organization) {
        const suffix = attempt === 0 ? user.id.slice(0, 8) : `${user.id.slice(0, 8)}-${attempt}`;
        try {
          organization = await tx.organization.create({
            data: { name: orgName, slug: `${baseSlug}-${suffix}` },
          });
        } catch (err) {
          attempt += 1;
          if (attempt > 5) throw err;
        }
      }

      await tx.member.create({
        data: { organizationId: organization.id, userId: user.id, role: "owner" },
      });

      // organizationId is a required column (see prisma/schema.prisma) — these only ever
      // match rows for a user who somehow has resources but no membership yet, which
      // shouldn't be reachable once organizationId is required, but stay harmless (0 rows
      // touched) if it ever happens.
      //
      // Raw SQL, not tx.template.updateMany(...): Prisma's query engine auto-bumps any
      // @updatedAt column on EVERY row touched by an update/updateMany, even when that
      // column isn't in `data`. The first run of this script did exactly that — silently
      // overwriting every template's real last-edited time with the migration's own
      // run time, which is what broke "newest first" ordering across the dashboard
      // (ties all landing on the same instant, sorted by whatever order Postgres
      // happened to return them in). Raw SQL bypasses that auto-touch entirely.
      await tx.$executeRaw`UPDATE "Template" SET "organizationId" = ${organization.id}::uuid WHERE "userId" = ${user.id}::uuid`;
      await tx.$executeRaw`UPDATE "ApiKey" SET "organizationId" = ${organization.id}::uuid WHERE "userId" = ${user.id}::uuid`;
      await tx.$executeRaw`UPDATE "PublishedDomain" SET "organizationId" = ${organization.id}::uuid WHERE "userId" = ${user.id}::uuid`;
      await tx.$executeRaw`UPDATE "UploadedImage" SET "organizationId" = ${organization.id}::uuid WHERE "userId" = ${user.id}::uuid`;
    });

    migrated += 1;
  }

  console.log(`Backfilled ${migrated} personal organization(s).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
