/**
 * One-off repair: turns the loose .html files of a raw-upload site (about.html, contact.html…, served
 * as plain files) into real pages of the site. Same thing that now happens automatically on upload,
 * re-upload and when a file is added in the editor (lib/rawSite/splitPages.ts).
 *
 *   npx tsx scripts/split-raw-site-pages.ts <siteTemplateId>            # dry run
 *   npx tsx scripts/split-raw-site-pages.ts <siteTemplateId> --apply    # writes
 *
 * Needs AWS credentials and the PLEXO_*_TABLE env for the target environment. The site keeps its
 * addresses (about.html is /about); nothing is published or unpublished.
 */
import { Template } from "../lib/db/contentEntities";
import { getTierFeatures } from "../lib/subscription";
import { getOrganizationOwnerPlanDynamo } from "../server/orgDynamo";
import { listLoosePages, splitHtmlAssetsIntoPages } from "../lib/rawSite/splitPages";

async function main() {
  const id = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!id) throw new Error("Pass the site's home page template id.");
  const { data: root } = await Template.get({ id }).go();
  if (!root) throw new Error(`No template ${id}.`);
  const plan = await getOrganizationOwnerPlanDynamo(root.organizationId);
  const multi = getTierFeatures(plan).multiPageSitesEnabled;
  const loose = await listLoosePages(id);
  console.log(JSON.stringify({ site: root.name, source: root.sourceType, plan, multiPageAllowed: multi, loosePages: loose }, null, 2));
  if (!multi) throw new Error("This plan doesn't include multi-page sites, so the files stay as they are.");
  if (!apply) return void console.log("DRY RUN — nothing written (pass --apply).");
  console.log(JSON.stringify(await splitHtmlAssetsIntoPages(root), null, 2));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
