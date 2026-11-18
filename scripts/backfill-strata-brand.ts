/**
 * One-off, staged: gives EXISTING websites a Strata project (named after the site, made from the site's saved colours and logo)
 * and links them, so every site's brand lives in Strata like new ones do. New sites do this by themselves; this catches up the rest.
 *
 *   npx tsx scripts/backfill-strata-brand.ts                       # dry run: lists what it would do, changes nothing
 *   npx tsx scripts/backfill-strata-brand.ts --apply --limit 5     # does the first 5 only (default limit when applying)
 *   npx tsx scripts/backfill-strata-brand.ts --apply --limit 200   # a bigger batch, once the first ones look right
 *   npx tsx scripts/backfill-strata-brand.ts --apply --site <id>   # one site
 *
 * Safe to re-run: a site that already follows a brand is skipped, and a site whose owner has no Charisol sign-in kept (so Plexo can't
 * connect Strata for them without asking) is skipped and counted. Look at a few finished sites before raising the limit: linking
 * writes the site's hosted brand sheet, so a project's base tokens can change small things (radii, neutrals) on a live site.
 * Needs the usual AWS credentials / PLEXO_*_TABLE env and STRATA_API_URL for the target environment.
 */
import "dotenv/config";

import { Template } from "../lib/db/contentEntities";
import { SiteBrand } from "../lib/db/coreEntities";
import { readSiteBrand } from "../lib/dashboardV3/brandLook";
import { ensureSiteBrandInStrata } from "../lib/strata/autoSetup";

const apply = process.argv.includes("--apply");
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const only = arg("--site");
const limit = Number(arg("--limit") ?? (apply ? 5 : Infinity));

async function main() {
  console.log(apply ? `APPLYING (up to ${limit} sites)` : "DRY RUN: nothing is changed (pass --apply to do it)");
  const { data: templates } = await Template.scan.go({ pages: "all" });
  const sites = templates.filter((t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && (!only || t.id === only));
  const counts = { linked: 0, noColours: 0, noOwner: 0, wouldDo: 0, created: 0, notConnected: 0, failed: 0 };
  let done = 0;
  for (const site of sites) {
    if (done >= limit) break;
    const { data: row } = await SiteBrand.get({ siteId: site.id }).go();
    if (row) { counts.linked++; continue; }
    if (!readSiteBrand(site.brand)?.colors?.length) { counts.noColours++; continue; }
    const userId = (site as { userId?: string }).userId;
    if (!userId || !site.organizationId) { counts.noOwner++; continue; }
    if (!apply) { counts.wouldDo++; console.log(`would set up: ${site.id}  ${site.name}`); continue; }
    done++;
    const result = await ensureSiteBrandInStrata({ siteId: site.id, userId, organizationId: site.organizationId });
    if (result.status === "created") { counts.created++; console.log(`created "${result.projectName}" for ${site.id}`); }
    else if (result.status === "not-connected") counts.notConnected++;
    else if (result.status === "failed") { counts.failed++; console.log(`could not set up ${site.id}`); }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(JSON.stringify({ sites: sites.length, ...counts }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
