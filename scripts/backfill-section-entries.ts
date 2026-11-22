/**
 * One-off: builds the "Section entries" index for sites that already use their own sections, so the dashboard list is
 * complete the first time anyone opens it. (The list also repairs itself when opened, and every page save keeps it current;
 * this just does the work ahead of time.)
 *
 *   npx tsx scripts/backfill-section-entries.ts            # dry run: lists the sites it would index
 *   npx tsx scripts/backfill-section-entries.ts --apply    # reads each site's pages and writes the index
 *
 * Only sites that have at least one section type are touched; nothing about any page or section is changed. Safe to run
 * again. Needs AWS credentials and the PLEXO_*_TABLE vars for the target environment.
 */
import "dotenv/config";

import { Template } from "../lib/db/contentEntities";
import { listTypesForSite } from "../lib/customSections/service";
import { siteEntries } from "../lib/customSections/placements";

const apply = process.argv.includes("--apply");

async function main() {
  const { data: sites } = await Template.scan.where(({ parentId, kind }, { notExists, eq }) => `${notExists(parentId)} AND ${eq(kind, "LANDING_PAGE")}`).go({ pages: "all", attributes: ["id", "organizationId", "name"] });
  let indexed = 0;
  let uses = 0;
  for (const site of sites) {
    if (!site.organizationId) continue;
    const types = await listTypesForSite(site.id);
    if (types.length === 0) continue;
    if (!apply) {
      console.log(`would index "${site.name}" (${site.id}) — ${types.length} section type(s)`);
      continue;
    }
    const rows = await siteEntries(site.id, site.organizationId, types);
    indexed++;
    uses += rows.length;
    console.log(`indexed "${site.name}": ${rows.length} use(s)`);
  }
  console.log(apply ? `Done. ${indexed} site(s), ${uses} use(s).` : "Dry run only. Add --apply to write.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
