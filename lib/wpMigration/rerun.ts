import { randomUUID } from "node:crypto";
import { WpMigrationAsset, WpMigrationJob, WpMigrationPage } from "@/lib/db/importEntities";
import { describeRerun, withNewRun, type RerunPreview, type RerunScope, type RunCounts } from "./history";

// Run a finished WordPress move again, whole or one step at a time. Every step already copies by
// "find or replace" (posts by their WordPress id, pages into their existing node, files by path), so
// running one again never makes a second copy: it puts the WordPress version back. The caller shows
// the preview first and only calls startRerun once the owner confirmed.

const BUSY = new Set(["PENDING", "PLANNING", "POSTS", "PRODUCTS", "PAGES", "ASSETS", "FINALIZING"]);

export type RerunResult =
  | { ok: true; jobId: string; templateId: string }
  | { ok: false; status: number; error: string };

/** What running `scope` again would do for this job; nothing changes. */
export async function previewRerun(templateId: string, jobId: string, scope: RerunScope): Promise<{ ok: true; preview: RerunPreview } | { ok: false; status: number; error: string }> {
  const { data: job } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!job) return { ok: false, status: 404, error: "We couldn't find that move." };
  return { ok: true, preview: describeRerun(scope, job.counts as RunCounts | undefined, job.sourceUrl) };
}

async function resetRows(jobId: string, scope: RerunScope): Promise<void> {
  const kinds: Record<RerunScope, ("WP_PAGE" | "STATIC_PAGE" | "POST" | "PRODUCT")[]> = {
    all: ["WP_PAGE", "STATIC_PAGE", "POST", "PRODUCT"],
    PAGES: ["WP_PAGE", "STATIC_PAGE"],
    POSTS: ["POST"],
    PRODUCTS: ["PRODUCT"],
    ASSETS: [],
  };
  const want = kinds[scope];
  if (want.length) {
    const { data: rows } = await WpMigrationPage.query.primary({ jobId }).go({ pages: "all" });
    for (const row of rows.filter((r) => want.includes(r.kind))) {
      await WpMigrationPage.patch({ jobId, key: row.key }).set({ status: "PENDING" }).remove(["error"]).go();
    }
  }
  if (scope === "ASSETS" || scope === "all") {
    const { data: assets } = await WpMigrationAsset.query.primary({ jobId }).go({ pages: "all" });
    for (const a of assets.filter((x) => x.status !== "PENDING")) {
      await WpMigrationAsset.patch({ jobId, path: a.path }).set({ status: "PENDING", attempts: 0 }).remove(["error"]).go();
    }
  }
}

/** Starts the run: resets what the step covers to "not copied yet" and points the job at the step. Never touches another run's history. */
export async function startRerun(templateId: string, jobId: string, scope: RerunScope): Promise<RerunResult> {
  const { data: job } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!job) return { ok: false, status: 404, error: "We couldn't find that move." };
  const phase = job.phase ?? "PENDING";
  if (BUSY.has(phase) && job.processing) return { ok: false, status: 409, error: "This move is still running. Wait for it to finish, then run it again." };
  if (BUSY.has(phase)) return { ok: false, status: 409, error: "This move hasn't finished yet. Let it finish (or try again from its progress page) before running it again." };
  // Another move on the account running at the same time would fight for the same WordPress host.
  const { data: orgJobs } = await WpMigrationJob.query.byOrg({ organizationId: job.organizationId }).go({ pages: "all" });
  if (orgJobs.some((j) => j.id !== jobId && BUSY.has(j.phase ?? "PENDING"))) return { ok: false, status: 409, error: "Another WordPress move is running right now. Wait for it to finish first." };
  if (scope === "PRODUCTS" && !((job.counts as RunCounts | undefined)?.products)) return { ok: false, status: 400, error: "This site didn't have a shop to move." };

  await resetRows(jobId, scope);
  const startedAt = new Date().toISOString();
  const runs = withNewRun(
    {
      id: job.id, templateId, sourceUrl: job.sourceUrl, phase, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
      counts: job.counts, runs: job.runs, movedLinks: job.movedLinks, report: job.report, errors: job.errors,
    },
    { id: randomUUID(), startedAt, scope, outcome: "running" },
  );
  const { pausedIn: _p, ...keep } = (job.planState as { pausedIn?: string } | undefined) ?? {};
  const planState = scope === "all" ? {} : { ...keep, onlyStep: scope };
  await WpMigrationJob.patch({ templateId, id: jobId })
    .set({ phase: scope === "all" ? "PLANNING" : scope, planState, runs, processing: false, transientRetries: 0, errors: [], startedAt })
    .remove(["finishedAt", "bannerDismissedAt"])
    .go();
  return { ok: true, jobId, templateId };
}
