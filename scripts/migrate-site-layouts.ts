/**
 * Gives every older site its (blank) shared header and footer, in bulk. The dashboard does the same one site at a
 * time, the first time a site's editor or "Header and footer" screen is opened; this just does the rest up front.
 *
 * A blank header/footer shows nothing, so no published page changes: nothing is recompiled and no page is saved.
 * Hand-written (uploaded) sites and code apps are skipped (they carry their own). A site that was ever given a header
 * and footer, including one the owner later removed, is left exactly as it is. Safe to re-run.
 *
 *   npx tsx scripts/migrate-site-layouts.ts                 # dry run: prints what it would do
 *   npx tsx scripts/migrate-site-layouts.ts --apply         # writes
 *   npx tsx scripts/migrate-site-layouts.ts --apply --limit 50
 *
 * Needs the usual AWS credentials / PLEXO_*_TABLE env for the target environment.
 */
import "dotenv/config";

import { SiteLayout, Template } from "../lib/db/contentEntities";
import { ensureBlankSiteLayout, siteKindForLayout } from "../lib/siteLayoutBlank";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) || Infinity : Infinity;

async function main() {
  console.log(apply ? "APPLYING: writing blank headers and footers" : "DRY RUN: nothing is written (pass --apply to write)");
  const counts = { seen: 0, created: 0, wouldCreate: 0, exists: 0, skipped: 0, failed: 0 };

  // Every site is a top-level landing page (no parent) that is not itself a header/footer.
  let cursor: string | null = null;
  do {
    const page: { data: Awaited<ReturnType<typeof Template.scan.go>>["data"]; cursor: string | null } = await Template.scan
      .where(({ kind, parentId }, { eq, notExists }) => `${eq(kind, "LANDING_PAGE")} AND ${notExists(parentId)}`)
      .go({ cursor, limit: 200 });
    for (const site of page.data) {
      if (site.isSiteLayoutFragment) continue;
      if (counts.seen >= limit) break;
      counts.seen++;
      const kind = siteKindForLayout(site);
      if (kind === "html" || kind === "app") {
        counts.skipped++;
        continue;
      }
      try {
        const { data: layout } = await SiteLayout.get({ templateId: site.id }).go();
        const already = !!(layout?.layoutProvisionedAt || layout?.headerTemplateId || layout?.footerTemplateId);
        if (already) {
          counts.exists++;
          continue;
        }
        if (!apply) {
          counts.wouldCreate++;
          console.log(`  would add a blank header and footer to ${site.id} "${site.name}" (${kind})`);
          continue;
        }
        const r = await ensureBlankSiteLayout(site.id, site.userId);
        if (r.status === "created") counts.created++;
        else counts.exists++;
      } catch (err) {
        counts.failed++;
        console.error(`  failed for ${site.id}:`, err instanceof Error ? err.message : err);
      }
    }
    cursor = counts.seen >= limit ? null : page.cursor;
  } while (cursor);

  console.log(counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
