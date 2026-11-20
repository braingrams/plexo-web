import { CloudFrontClient, CreateInvalidationCommand, CreateInvalidationForDistributionTenantCommand } from "@aws-sdk/client-cloudfront";
import { PublishedDomain, Template } from "@/lib/db/contentEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { listSitePages } from "@/lib/pub/siteSitemap";

/**
 * Clears the edge's saved copies of a site's pages the moment the owner publishes or changes something, so the short
 * cache (PAGE_CACHE_CONTROL: one minute) never makes a change feel slow. Best effort by design: if it cannot run (no
 * distribution configured, a limit reached, AWS says no) nothing breaks, the saved copies simply expire within a minute.
 *
 * Cost guards (CloudFront gives 1,000 cleared paths a month free, then charges a fraction of a cent each):
 * - a site is cleared at most once per 10 seconds, so a burst of edits is one clear;
 * - a custom domain is cleared with one wildcard path (it is its own tenant, so only its own copies go);
 * - a plexopages address is cleared by the exact paths of the site's pages (so other sites are not emptied), and one
 *   wildcard only when it has more than MAX_PATHS pages;
 * - one daily ceiling for everyone (PAGE_PURGE_DAILY, default 3000 clears).
 */

const MAX_PATHS = 30;
const client = new CloudFrontClient({ region: process.env.AWS_REGION || "us-east-1" });

export type PurgePlan = { tenantId: string | null; paths: string[] };

/** Pure: the paths to clear for one address. */
export function pathsToClear(pages: { loc: string }[], host: string): string[] {
  const set = new Set<string>(["/"]);
  for (const p of pages) {
    try {
      const u = new URL(p.loc);
      if (u.host === host) {
        const path = u.pathname || "/";
        set.add(path);
        // The page answers with or without the trailing slash.
        set.add(path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path === "/" ? "/" : `${path}/`);
      }
    } catch {
      // not an address, skip it
    }
  }
  // Pages that were just renamed or deleted are covered by the short cache; cleared lists stay small and cheap.
  return set.size > MAX_PATHS ? ["/*"] : [...set];
}

export async function purgeSitePages(siteId: string): Promise<{ cleared: number; skipped?: string }> {
  const distributionId = process.env.PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID;
  if (!distributionId) return { cleared: 0, skipped: "no distribution configured" };
  try {
    if (!(await checkCommerceRateLimit(`purge:site:${siteId}`, 1, 10_000))) return { cleared: 0, skipped: "cleared a moment ago" };
    const daily = Number(process.env.PAGE_PURGE_DAILY ?? 3000);
    if (!(await checkCommerceRateLimit("purge:global", daily, 24 * 60 * 60 * 1000))) return { cleared: 0, skipped: "daily limit reached" };
    const { data: domains } = await PublishedDomain.query.primary({ templateId: siteId }).go({ pages: "all" });
    const live = domains.filter((d) => d.active !== false);
    if (!live.length) return { cleared: 0, skipped: "not live" };
    const { data: root } = await Template.get({ id: siteId }).go();
    const callerReference = `${siteId}-${Date.now()}`;
    let cleared = 0;
    let wildcardPaths: string[] | null = null;
    for (const d of live) {
      if (d.type === "CUSTOM" && d.tenantId) {
        await client.send(new CreateInvalidationForDistributionTenantCommand({ Id: d.tenantId, InvalidationBatch: { CallerReference: `${callerReference}-${d.id}`, Paths: { Quantity: 1, Items: ["/*"] } } }));
        cleared++;
      } else if (root) {
        const pages = await listSitePages(root, d.domain, false);
        wildcardPaths = [...new Set([...(wildcardPaths ?? []), ...pathsToClear(pages, d.domain)])];
      }
    }
    if (wildcardPaths?.length) {
      const items = wildcardPaths.length > MAX_PATHS ? ["/*"] : wildcardPaths;
      await client.send(new CreateInvalidationCommand({ DistributionId: distributionId, InvalidationBatch: { CallerReference: `${callerReference}-d`, Paths: { Quantity: items.length, Items: items } } }));
      cleared++;
    }
    return { cleared };
  } catch (err) {
    console.error("edge cache clear failed (the one-minute cache will expire by itself):", err instanceof Error ? err.message : "unknown error");
    return { cleared: 0, skipped: "failed" };
  }
}

/** For callers that must not wait or fail on it. */
export function purgeSitePagesInBackground(siteId: string): void {
  void purgeSitePages(siteId).catch(() => undefined);
}
