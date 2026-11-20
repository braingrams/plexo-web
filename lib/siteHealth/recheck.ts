import { PublishedDomain, Template } from "@/lib/db/contentEntities";
import { SiteHealthCheck, SiteHealthRecheck } from "@/lib/db/opsEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { purgeSitePages } from "@/lib/pub/edgeCache";
import { learnSizes, imagesNeedingSize } from "./imageSize";
import { loadSitePages } from "./sitePages";
import { healthSettingsFor } from "./serve";
import { runSiteCheck, WEEKLY_MS } from "./service";

/**
 * Automatic re-checks. Two triggers feed one queue (SiteHealthRecheck):
 *  - "changed": the owner published or edited the site, or switched a fix on or off. The check runs RECHECK_DELAY_MS after the
 *    LAST change (every new change pushes the time back, so a burst of edits is one check).
 *  - "weekly": a live site whose last check is older than a week (queued by the daily sweep).
 * A scheduled job (cdk: SiteHealthRecheck, every 10 minutes, app/api/internal/site-health/recheck) runs what is due, within
 * a time budget and the cost limits in service.ts (own daily allowance for automatic checks, a per-account daily cap).
 * The owner sees the result, with the trend, the next time they open Site health.
 */

export const RECHECK_DELAY_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 4;

/** Only sites whose owner has used Site health (a check or a fix) are re-checked after a change; every live site gets the weekly turn. */
async function engaged(siteId: string): Promise<boolean> {
  const { data } = await SiteHealthCheck.query.primary({ templateId: siteId }).go({ limit: 1 });
  return data.length > 0;
}

/** Queues (or pushes back) a re-check after a change. Safe to call often. */
export async function queueRecheck(siteId: string, reason: "changed" | "weekly" = "changed", now = Date.now()): Promise<void> {
  if (reason === "changed" && !(await engaged(siteId))) return;
  const dueAt = new Date(now + (reason === "changed" ? RECHECK_DELAY_MS : 0)).toISOString();
  await SiteHealthRecheck.upsert({ templateId: siteId, reason, dueAt, queuedAt: new Date(now).toISOString(), attempts: 0 }).go();
}

/** After a fix was switched on or off: the edge's saved copies are cleared and a re-check is queued. Never throws, never waits. */
export function afterHealthSettingsChanged(siteId: string): void {
  void (async () => {
    try {
      await purgeSitePages(siteId);
      await queueRecheck(siteId, "changed");
      // Pictures added since the "stop the jumping" fix was switched on get measured too.
      if ((await healthSettingsFor(siteId)).extras.image_sizes) await learnNewPictureSizes(siteId);
    } catch (err) {
      console.error("site health: after-change work failed:", err instanceof Error ? err.message : "unknown error");
    }
  })();
}

/** Measures pictures we have not measured yet (new ones, or ones that were unreachable more than a week ago). */
export async function learnNewPictureSizes(siteId: string): Promise<void> {
  const pages = await loadSitePages(siteId);
  await learnSizes(pages.flatMap((p) => imagesNeedingSize(p.html, "https://example.invalid/")).filter((u) => !u.includes("example.invalid")), { deadlineMs: 20_000 });
}

export type RunSummary = { ran: number; skipped: number; failed: number; waiting: number; stoppedEarly: boolean };

/** Runs what is due, one after another, until the time budget is used. A site that cannot be checked right now stays queued and is tried again later. */
export async function processRecheckQueue(opts: { budgetMs?: number; max?: number; now?: number } = {}): Promise<RunSummary> {
  const started = Date.now();
  const budget = opts.budgetMs ?? Number(process.env.SITE_HEALTH_RUN_BUDGET_MS ?? 40_000);
  const max = opts.max ?? Number(process.env.SITE_HEALTH_RECHECK_PER_RUN ?? 12);
  const now = opts.now ?? Date.now();
  const { data } = await SiteHealthRecheck.query.primary({}).go({ pages: "all" });
  const due = data.filter((r) => r.dueAt <= new Date(now).toISOString()).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const summary: RunSummary = { ran: 0, skipped: 0, failed: 0, waiting: Math.max(0, data.length - due.length), stoppedEarly: false };
  for (const row of due.slice(0, max)) {
    // One check takes up to ~40 seconds: do not start another unless it can finish inside the budget.
    if (Date.now() - started > budget - 25_000) {
      summary.stoppedEarly = true;
      break;
    }
    const { data: site } = await Template.get({ id: row.templateId }).go();
    if (!site || site.parentId || site.kind !== "LANDING_PAGE") {
      await SiteHealthRecheck.delete({ templateId: row.templateId }).go();
      summary.skipped++;
      continue;
    }
    const outcome = await runSiteCheck({ id: site.id, organizationId: site.organizationId }, { scheduled: row.reason });
    if (outcome.ok) {
      await SiteHealthRecheck.delete({ templateId: row.templateId }).go();
      outcome.cached ? summary.skipped++ : summary.ran++;
    } else if (outcome.status === 409) {
      // Not live (or unpublished since): nothing to check.
      await SiteHealthRecheck.delete({ templateId: row.templateId }).go();
      summary.skipped++;
    } else {
      summary.failed++;
      const attempts = (row.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) await SiteHealthRecheck.delete({ templateId: row.templateId }).go();
      else await SiteHealthRecheck.patch({ templateId: row.templateId }).set({ attempts, dueAt: new Date(now + 60 * 60 * 1000).toISOString() }).go();
    }
  }
  return summary;
}

const shuffle = <T,>(a: T[]): T[] => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Pure: which of these sites need their weekly turn, given when each was last checked (null = never). */
export function dueForWeekly(sites: { id: string; lastCheckAt: string | null }[], now: number): string[] {
  return sites.filter((s) => !s.lastCheckAt || now - new Date(s.lastCheckAt).getTime() >= WEEKLY_MS).map((s) => s.id);
}

/**
 * Finds live sites whose last check is over a week old (or that were never checked) and puts them in the queue. It only queues:
 * the queue runner does the checks at a pace the cost limits allow. At most `max` sites are queued per sweep.
 */
export async function sweepWeekly(opts: { max?: number; now?: number } = {}): Promise<{ looked: number; queued: number }> {
  const max = opts.max ?? Number(process.env.SITE_HEALTH_WEEKLY_QUEUE_PER_SWEEP ?? 300);
  const now = opts.now ?? Date.now();
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page: { data: { templateId: string; active?: boolean; planDisabledAt?: string }[]; cursor: string | null } = await PublishedDomain.scan.where(({ active }, { eq }) => eq(active, true)).go({ cursor });
    for (const d of page.data) if (!d.planDisabledAt) ids.add(d.templateId);
    cursor = page.cursor;
    if (!cursor) break;
  }
  const queuedAlready = new Set((await SiteHealthRecheck.query.primary({}).go({ pages: "all" })).data.map((r) => r.templateId));
  let looked = 0;
  let queued = 0;
  for (const id of shuffle([...ids])) {
    if (queued >= max) break;
    if (queuedAlready.has(id)) continue;
    looked++;
    const { data } = await SiteHealthCheck.query.primary({ templateId: id }).go({ order: "desc", limit: 1 });
    if (dueForWeekly([{ id, lastCheckAt: data[0]?.createdAt ?? null }], now).length) {
      await queueRecheck(id, "weekly", now);
      queued++;
    }
  }
  return { looked, queued };
}

/** A job that may be started again by a retry must not run twice at once. True when this call holds the lock. */
export async function takeJobLock(name: string, windowMs: number): Promise<boolean> {
  return checkCommerceRateLimit(`sitehealth:job:${name}`, 1, windowMs);
}
