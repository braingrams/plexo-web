/**
 * One-off, read-only pre-flight check before shipping the blog feature: the public
 * blog is served from a literal "/blog" path segment (app/pub/[domain]/blog/**), which
 * takes routing precedence over any existing root-level page/asset also named "blog".
 * This reports anything that would be shadowed so it can be renamed first.
 *
 * Usage: npx tsx scripts/audit-blog-collisions.ts
 */
import "dotenv/config";
import { prisma } from "../server/prisma";

async function main() {
  const shadowedPages = await prisma.template.findMany({
    where: { parentId: { not: null }, slug: "blog" },
    select: { id: true, name: true, parentId: true, organizationId: true },
  });

  const shadowedAssets = await prisma.templateAsset.findMany({
    where: { path: { startsWith: "blog/" } },
    select: { id: true, templateId: true, path: true },
  });

  console.log(`Root-level pages slugged "blog": ${shadowedPages.length}`);
  for (const p of shadowedPages) {
    console.log(`  - Template ${p.id} ("${p.name}") org=${p.organizationId} parent=${p.parentId}`);
  }

  console.log(`Raw-upload assets under "blog/": ${shadowedAssets.length}`);
  for (const a of shadowedAssets) {
    console.log(`  - Template ${a.templateId}: ${a.path}`);
  }

  if (shadowedPages.length === 0 && shadowedAssets.length === 0) {
    console.log("No collisions found — safe to ship the literal /blog route.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
