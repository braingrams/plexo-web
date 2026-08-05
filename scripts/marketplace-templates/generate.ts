/**
 * Bulk-generates the 100 marketplace starter templates (10 categories x 10 templates:
 * landing pages, opt-in/lead-capture pages, and emails) from the spec files in ./specs,
 * validates + compiles each one exactly the way every real write path does
 * (server/sanitizer.ts's TemplateJSONSchema, then plexo-sdk's compileToHTML), and inserts
 * them as DRAFT marketplace listings owned by the system "Plexo Templates" account —
 * mirroring plexo-admin's createBlankListing + updateListingDesign + updateListing, just
 * batched instead of one-by-one through the admin UI.
 *
 * Usage:
 *   npx tsx scripts/marketplace-templates/generate.ts --dry-run   (validate + compile only, no DB writes)
 *   npx tsx scripts/marketplace-templates/generate.ts             (also inserts as DRAFT)
 */
import "dotenv/config";
import { compileToHTML } from "@charisol/plexo-sdk/compiler";

import { prisma } from "../../server/prisma";
import { TemplateJSONSchema, hydrateStructuralDefaults } from "../../server/sanitizer";
import { compileSpecToDesignJson } from "./compile";
import type { CategoryBatch, TemplateSpec } from "./types";

import { ecommerceBatch } from "./specs/ecommerce";
import { blogMediaBatch } from "./specs/blog-media";
import { corporateBatch } from "./specs/corporate";
import { localBusinessBatch } from "./specs/local-business";
import { entertainmentBatch } from "./specs/entertainment";
import { musicBatch } from "./specs/music";
import { saasBatch } from "./specs/saas";
import { healthFitnessBatch } from "./specs/health-fitness";
import { educationBatch } from "./specs/education";
import { realEstateBatch } from "./specs/real-estate";

const MARKETPLACE_OWNER_EMAIL = "templates@plexo.charisol.io";

/** Mirrors plexo-admin's lib/marketplaceOwner.ts getOrCreateMarketplaceOwner exactly — both apps share this one Postgres DB. */
async function getOrCreateMarketplaceOwner(): Promise<{ userId: string; organizationId: string }> {
  const existing = await prisma.user.findUnique({
    where: { email: MARKETPLACE_OWNER_EMAIL },
    include: { memberships: { take: 1 } },
  });

  if (existing && existing.memberships[0]) {
    return { userId: existing.id, organizationId: existing.memberships[0].organizationId };
  }

  if (existing) {
    const org = await prisma.organization.create({
      data: { name: "Plexo Templates", slug: `plexo-templates-${existing.id.slice(0, 8)}` },
    });
    await prisma.member.create({ data: { organizationId: org.id, userId: existing.id, role: "owner" } });
    return { userId: existing.id, organizationId: org.id };
  }

  const user = await prisma.user.create({
    data: { email: MARKETPLACE_OWNER_EMAIL, name: "Plexo Templates", isConfirmed: true, subscriptionPlan: "ULTRA" },
  });
  const org = await prisma.organization.create({
    data: { name: "Plexo Templates", slug: `plexo-templates-${user.id.slice(0, 8)}` },
  });
  await prisma.member.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });

  return { userId: user.id, organizationId: org.id };
}

/** tier "quick" is always free; "premium" is priced by how much content the template actually has. */
function priceForSpec(spec: TemplateSpec): number {
  if (spec.tier === "quick") return 0;
  const sectionCount = spec.sections.length;
  if (spec.kind === "EMAIL") {
    return Math.min(2900, 900 + sectionCount * 200);
  }
  return Math.min(4900, 1900 + sectionCount * 400);
}

const BATCHES: CategoryBatch[] = [
  ecommerceBatch,
  blogMediaBatch,
  corporateBatch,
  localBusinessBatch,
  entertainmentBatch,
  musicBatch,
  saasBatch,
  healthFitnessBatch,
  educationBatch,
  realEstateBatch,
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const errors: string[] = [];
  let templateIndex = 0;
  let freeCount = 0;
  let paidCount = 0;

  const rowsToInsert: Array<{
    name: string;
    kind: "EMAIL" | "LANDING_PAGE";
    designJson: any;
    compiledHtml: string;
    marketplaceCategory: string;
    marketplaceDescription: string;
    priceCents: number;
  }> = [];

  for (const batch of BATCHES) {
    if (batch.specs.length !== 10) {
      errors.push(`Category "${batch.category}" has ${batch.specs.length} specs, expected 10.`);
    }
    for (const spec of batch.specs) {
      templateIndex += 1;
      const label = `[${batch.category}] ${spec.name}`;
      try {
        const rawDesignJson = compileSpecToDesignJson(spec, templateIndex);
        const hydrated = hydrateStructuralDefaults(rawDesignJson);
        const validated = TemplateJSONSchema.parse(hydrated);
        const compiledHtml = compileToHTML(validated);
        if (!compiledHtml || compiledHtml.trim().length === 0) {
          errors.push(`${label}: compileToHTML produced empty output.`);
          continue;
        }
        const priceCents = priceForSpec(spec);
        if (priceCents > 0) paidCount += 1;
        else freeCount += 1;

        rowsToInsert.push({
          name: spec.name,
          kind: spec.kind,
          designJson: validated,
          compiledHtml,
          marketplaceCategory: batch.category,
          marketplaceDescription: spec.description,
          priceCents,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        errors.push(`${label}: ${reason}`);
      }
    }
  }

  console.log(`Compiled ${rowsToInsert.length}/${templateIndex} templates across ${BATCHES.length} categories.`);
  console.log(`Free: ${freeCount}  Paid: ${paidCount}`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s):`);
    for (const e of errors) console.error(` - ${e}`);
    process.exitCode = 1;
    if (rowsToInsert.length === 0) return;
  }

  if (dryRun) {
    console.log("\nDry run only — no DB writes performed.");
    return;
  }

  const owner = await getOrCreateMarketplaceOwner();
  console.log(`\nInserting under marketplace owner ${owner.userId} / org ${owner.organizationId} ...`);

  let inserted = 0;
  for (const row of rowsToInsert) {
    const existing = await prisma.template.findFirst({
      where: { userId: owner.userId, name: row.name, marketplaceCategory: row.marketplaceCategory },
      select: { id: true },
    });
    const data = {
      name: row.name,
      kind: row.kind as any,
      designJson: row.designJson,
      compiledHtml: row.compiledHtml,
      marketplaceStatus: "DRAFT" as any,
      marketplaceCategory: row.marketplaceCategory,
      marketplaceDescription: row.marketplaceDescription,
      priceCents: row.priceCents,
    };
    if (existing) {
      await prisma.template.update({ where: { id: existing.id }, data });
    } else {
      await prisma.template.create({ data: { userId: owner.userId, organizationId: owner.organizationId, ...data } });
    }
    inserted += 1;
  }

  console.log(`Inserted/updated ${inserted} DRAFT marketplace templates.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
