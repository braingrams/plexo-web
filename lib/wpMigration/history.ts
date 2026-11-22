// The history of a WordPress move, in plain words: every run (the first move, then each time it was
// run again), what it moved and how it ended. Pure: no database, no React.

export type RerunScope = "all" | "POSTS" | "PAGES" | "ASSETS" | "PRODUCTS";

export type RunOutcome = "running" | "completed" | "paused" | "failed" | "cancelled";

/** One run, as stored on the job (`runs`). */
export interface StoredRun {
  id: string;
  startedAt: string;
  finishedAt?: string | null;
  scope: RerunScope;
  outcome: RunOutcome;
  /** What had been moved when the run ended (the job's counts then). */
  counts?: RunCounts | null;
  /** Redirects the run had in place. */
  redirects?: number;
  forms?: number;
  /** The plain-words problem the run stopped on, if it did. */
  error?: string | null;
}

export interface RunCounts {
  pagesDone?: number;
  pages?: number;
  pagesFailed?: number;
  postsDone?: number;
  posts?: number;
  postsFailed?: number;
  assetsDone?: number;
  assets?: number;
  assetsFailed?: number;
  productsDone?: number;
  products?: number;
  productsFailed?: number;
}

export type MovedItem = { id: "pages" | "posts" | "media" | "products" | "forms" | "redirects"; label: string; count: number; failed: number };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What a run moved: pages, posts, pictures and files, shop products, forms and redirects (zero ones left out). */
export function movedItems(run: Pick<StoredRun, "counts" | "redirects" | "forms">): MovedItem[] {
  const c = run.counts ?? {};
  const rows: MovedItem[] = [
    { id: "pages", label: plural(c.pagesDone ?? 0, "page", "pages"), count: c.pagesDone ?? 0, failed: c.pagesFailed ?? 0 },
    { id: "posts", label: plural(c.postsDone ?? 0, "blog post", "blog posts"), count: c.postsDone ?? 0, failed: c.postsFailed ?? 0 },
    { id: "media", label: plural(c.assetsDone ?? 0, "picture or file", "pictures and files"), count: c.assetsDone ?? 0, failed: c.assetsFailed ?? 0 },
    { id: "products", label: plural(c.productsDone ?? 0, "product", "products"), count: c.productsDone ?? 0, failed: c.productsFailed ?? 0 },
    { id: "forms", label: plural(run.forms ?? 0, "form", "forms"), count: run.forms ?? 0, failed: 0 },
    { id: "redirects", label: plural(run.redirects ?? 0, "redirect", "redirects"), count: run.redirects ?? 0, failed: 0 },
  ];
  return rows.filter((r) => r.count > 0 || r.failed > 0);
}

/** "42 pages, 18 blog posts, 310 pictures and files" (and "3 didn't copy" when some failed). */
export function movedSentence(run: Pick<StoredRun, "counts" | "redirects" | "forms">): string {
  const items = movedItems(run);
  if (!items.length) return "Nothing copied yet";
  const text = items.map((i) => `${i.count.toLocaleString("en-US")} ${i.label}`).join(", ");
  const failed = items.reduce((s, i) => s + i.failed, 0);
  return failed ? `${text}. ${failed.toLocaleString("en-US")} didn't copy.` : text;
}

export function outcomeOf(phase: string | null | undefined): RunOutcome {
  if (phase === "COMPLETED") return "completed";
  if (phase === "FAILED") return "failed";
  if (phase === "CANCELLED") return "cancelled";
  if (phase === "PAUSED_ERROR") return "paused";
  return "running";
}

export const OUTCOME_LABEL: Record<RunOutcome, { text: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  completed: { text: "Finished", tone: "success" },
  paused: { text: "Stopped, needs a look", tone: "warning" },
  failed: { text: "Didn't finish", tone: "danger" },
  cancelled: { text: "Cancelled", tone: "neutral" },
  running: { text: "Moving now", tone: "info" },
};

export const SCOPE_LABEL: Record<RerunScope, string> = {
  all: "Whole move",
  PAGES: "Pages",
  POSTS: "Blog posts",
  ASSETS: "Pictures and files",
  PRODUCTS: "Shop products",
};

export interface JobLike {
  id: string;
  templateId: string;
  sourceUrl: string;
  phase?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  counts?: unknown;
  runs?: unknown;
  movedLinks?: unknown;
  report?: unknown;
  errors?: unknown;
}

export interface HistoryEntry extends StoredRun {
  jobId: string;
  /** Number of the run, oldest = 1. */
  number: number;
}

export interface SiteHistory {
  templateId: string;
  sourceUrl: string;
  /** Newest first. */
  runs: HistoryEntry[];
  /** The newest run is still going. */
  active: boolean;
  latestJobId: string;
}

/** The run that the job itself is (its first move), read from the job's own fields. */
export function firstRunOf(job: JobLike): StoredRun {
  const report = job.report as { summary?: { formsReconnected?: number }; forms?: unknown[] } | null | undefined;
  const errors = Array.isArray(job.errors) ? (job.errors as string[]) : [];
  const outcome = outcomeOf(job.phase);
  return {
    id: `${job.id}:first`,
    startedAt: job.startedAt ?? job.createdAt ?? "",
    finishedAt: job.finishedAt ?? null,
    scope: "all",
    outcome,
    counts: (job.counts as RunCounts | undefined) ?? null,
    redirects: job.movedLinks && typeof job.movedLinks === "object" ? Object.keys(job.movedLinks as object).length : 0,
    forms: report?.summary?.formsReconnected ?? (Array.isArray(report?.forms) ? report!.forms!.length : 0),
    error: outcome === "paused" || outcome === "failed" ? (errors.slice(-1)[0] ?? null) : null,
  };
}

/** Every site's history from its jobs (any order in, newest run first out). Sites with no jobs don't appear. */
export function buildHistories(jobs: JobLike[]): SiteHistory[] {
  const bySite = new Map<string, JobLike[]>();
  for (const j of jobs) bySite.set(j.templateId, [...(bySite.get(j.templateId) ?? []), j]);
  const out: SiteHistory[] = [];
  for (const [templateId, list] of bySite) {
    const ordered = [...list].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    const all: (StoredRun & { jobId: string })[] = [];
    for (const job of ordered) {
      const stored = Array.isArray(job.runs) ? (job.runs as StoredRun[]) : [];
      // Once a job has stored runs, the first one was snapshotted there; before that the job IS the first run.
      const runs = stored.length ? stored : [firstRunOf(job)];
      for (const r of runs) all.push({ ...r, jobId: job.id });
    }
    all.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const numbered = all.map((r, i) => ({ ...r, number: i + 1 })).reverse();
    const latest = ordered[ordered.length - 1];
    out.push({ templateId, sourceUrl: latest.sourceUrl, runs: numbered, active: numbered[0]?.outcome === "running", latestJobId: latest.id });
  }
  return out.sort((a, b) => (b.runs[0]?.startedAt ?? "").localeCompare(a.runs[0]?.startedAt ?? ""));
}

export type RerunPreview = { scope: RerunScope; title: string; willDo: string; willReplace: string; keeps: string; steps: RerunScope[] };

/** What running a step again does, said before anything changes. `counts` is what's there now. */
export function describeRerun(scope: RerunScope, counts: RunCounts | null | undefined, sourceUrl: string): RerunPreview {
  const c = counts ?? {};
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");
  const from = `from ${sourceUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const keeps = "Your address, redirects and anything you've added that didn't come from WordPress stay as they are.";
  switch (scope) {
    case "POSTS":
      return { scope, title: "Copy the blog posts again", willDo: `Reads your ${n(c.posts)} blog ${plural(c.posts ?? 0, "post", "posts")} ${from} again.`, willReplace: "Posts you've changed on Plexo go back to the WordPress version. New posts are added. Nothing is copied twice.", keeps, steps: ["POSTS"] };
    case "PAGES":
      return { scope, title: "Rebuild the pages again", willDo: `Reads your ${n(c.pages)} ${plural(c.pages ?? 0, "page", "pages")} ${from} again.`, willReplace: "Pages you've edited on Plexo go back to how WordPress shows them now.", keeps, steps: ["PAGES"] };
    case "ASSETS":
      return { scope, title: "Copy the pictures and files again", willDo: `Fetches ${n(c.assets)} ${plural(c.assets ?? 0, "picture or file", "pictures and files")} ${from} again.`, willReplace: "Files with the same name are replaced by the WordPress copy. Ones you uploaded under other names are left alone.", keeps, steps: ["ASSETS"] };
    case "PRODUCTS":
      return { scope, title: "Copy the shop products again", willDo: `Reads your ${n(c.products)} ${plural(c.products ?? 0, "product", "products")} ${from} again.`, willReplace: "Products you've changed on Plexo go back to the WordPress version. Orders you've already taken aren't touched.", keeps, steps: ["PRODUCTS"] };
    default:
      return { scope: "all", title: "Run the whole move again", willDo: `Reads everything ${from} again: pages, posts, pictures and files${(c.products ?? 0) > 0 ? ", products" : ""}.`, willReplace: "Anything you've edited on Plexo that came from WordPress goes back to the WordPress version. It can take a while on a big site.", keeps, steps: ["POSTS", "PAGES", "ASSETS"] };
  }
}

/** Steps that can be run on their own for this site (products only when it had a shop). */
export function stepsFor(counts: RunCounts | null | undefined): RerunScope[] {
  return (["PAGES", "POSTS", "ASSETS", ...((counts?.products ?? 0) > 0 ? (["PRODUCTS"] as const) : [])] as RerunScope[]);
}

export function isRerunScope(v: unknown): v is RerunScope {
  return v === "all" || v === "POSTS" || v === "PAGES" || v === "ASSETS" || v === "PRODUCTS";
}

/** Appends a run, snapshotting the job's own first run first when nothing is stored yet. */
export function withNewRun(job: JobLike, run: StoredRun): StoredRun[] {
  const stored = Array.isArray(job.runs) ? (job.runs as StoredRun[]) : [];
  return [...(stored.length ? stored : [firstRunOf(job)]), run];
}

/** Closes the newest open run with how it ended. */
export function closeLatestRun(runs: StoredRun[], end: { outcome: RunOutcome; finishedAt: string; counts?: RunCounts | null; redirects?: number; forms?: number; error?: string | null }): StoredRun[] {
  const idx = [...runs].map((r) => r.outcome).lastIndexOf("running");
  if (idx < 0) return runs;
  return runs.map((r, i) => (i === idx ? { ...r, ...end } : r));
}
