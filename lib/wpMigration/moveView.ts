// Plain-words view of a WordPress move, for the v3 migration screens: the five stages a
// person watches, what needs a look in the report (with a fix for each), address checks and
// domain-check pills. Pure functions — no fetching, no React — so they're easy to test.

import type { ChecklistItem, Counts, JobStatus, Report } from "@/app/dashboard/migrate/wordpress/wizard/types";

// ── Progress ───────────────────────────────────────────────────────────────────

/** The server's phases, in the order they run, with how much of the wait each one is. */
const PHASE_WEIGHT: Record<string, number> = { PLANNING: 5, POSTS: 25, PRODUCTS: 10, PAGES: 25, ASSETS: 30, FINALIZING: 5 };
const PHASE_ORDER = ["PLANNING", "POSTS", "PRODUCTS", "PAGES", "ASSETS", "FINALIZING"];

export const TERMINAL_PHASES = ["COMPLETED", "FAILED", "CANCELLED", "PAUSED_ERROR"];

const frac = (done: number, total: number) => (total > 0 ? Math.min(1, done / total) : 0);

function phaseFraction(phase: string, c: Counts | null): number {
  if (!c) return 0;
  if (phase === "POSTS") return frac(c.postsDone + c.postsFailed, c.posts);
  if (phase === "PRODUCTS") return frac((c.productsDone ?? 0) + (c.productsSkipped ?? 0) + (c.productsFailed ?? 0), c.products ?? 0);
  if (phase === "PAGES") return frac(c.pagesDone + c.pagesFailed, c.pages);
  if (phase === "ASSETS") return frac(c.assetsDone + c.assetsFailed + c.assetsSkipped, c.assets);
  return 0.5;
}

/** The phase the move is in (or stopped in), with PENDING counted as the first. */
export function currentPhase(job: Pick<JobStatus, "phase" | "pausedIn">): string {
  if (job.phase === "PAUSED_ERROR") return job.pausedIn ?? "PLANNING";
  return job.phase === "PENDING" ? "PLANNING" : job.phase;
}

/** How far along the whole move is, 0–100. */
export function movePercent(job: Pick<JobStatus, "phase" | "pausedIn" | "counts">): number {
  if (job.phase === "COMPLETED") return 100;
  const phase = currentPhase(job);
  const phases = PHASE_ORDER.filter((p) => p !== "PRODUCTS" || (job.counts?.products ?? 0) > 0);
  const total = phases.reduce((s, p) => s + PHASE_WEIGHT[p], 0);
  const idx = phases.indexOf(phase);
  if (idx < 0) return 1;
  const before = phases.slice(0, idx).reduce((s, p) => s + PHASE_WEIGHT[p], 0);
  return ((before + PHASE_WEIGHT[phase] * phaseFraction(phase, job.counts)) / total) * 100;
}

export type StageState = "done" | "active" | "stopped" | "todo";
export interface Stage {
  id: "find" | "content" | "build" | "pictures" | "check";
  title: string;
  /** What's happening, while it's the current stage. */
  doing: string;
  state: StageState;
  /** 0–100 inside this stage. */
  percent: number;
  /** "12 of 40 blog posts" — empty when there's nothing to count. */
  detail: string;
}

const STAGE_DEFS: { id: Stage["id"]; title: string; doing: string; phases: string[] }[] = [
  { id: "find", title: "Finding your pages", doing: "Reading your WordPress site to see what's on it", phases: ["PLANNING"] },
  { id: "content", title: "Copying your content", doing: "Copying your blog posts and products", phases: ["POSTS", "PRODUCTS"] },
  { id: "build", title: "Building your site", doing: "Rebuilding each page with its layout and design", phases: ["PAGES"] },
  { id: "pictures", title: "Copying your pictures", doing: "Copying your images, fonts and files", phases: ["ASSETS"] },
  { id: "check", title: "Checking everything", doing: "Checking every link and search setting", phases: ["FINALIZING"] },
];

const n = (x: number) => x.toLocaleString("en-US");

function stageDetail(id: Stage["id"], c: Counts | null): string {
  if (!c) return "";
  if (id === "content") {
    const parts = [
      c.posts ? `${n(c.postsDone + c.postsFailed)} of ${n(c.posts)} blog posts` : "",
      c.products ? `${n((c.productsDone ?? 0) + (c.productsSkipped ?? 0) + (c.productsFailed ?? 0))} of ${n(c.products)} products` : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }
  if (id === "build" && c.pages) return `${n(c.pagesDone + c.pagesFailed)} of ${n(c.pages)} pages`;
  if (id === "pictures" && c.assets) return `${n(c.assetsDone + c.assetsFailed + c.assetsSkipped)} of ${n(c.assets)} pictures and files`;
  return "";
}

function stagePercent(id: Stage["id"], c: Counts | null): number {
  if (!c) return 0;
  if (id === "content") {
    const total = c.posts + (c.products ?? 0);
    const done = c.postsDone + c.postsFailed + (c.productsDone ?? 0) + (c.productsSkipped ?? 0) + (c.productsFailed ?? 0);
    return Math.round(frac(done, total) * 100);
  }
  if (id === "build") return Math.round(frac(c.pagesDone + c.pagesFailed, c.pages) * 100);
  if (id === "pictures") return Math.round(frac(c.assetsDone + c.assetsFailed + c.assetsSkipped, c.assets) * 100);
  return 50;
}

/** The stages a person watches, each marked done / active / stopped / still to come. */
export function moveStages(job: Pick<JobStatus, "phase" | "pausedIn" | "counts">): Stage[] {
  const stopped = job.phase === "PAUSED_ERROR" || job.phase === "FAILED";
  const phase = job.phase === "COMPLETED" ? "FINALIZING" : currentPhase(job);
  const defs = STAGE_DEFS;
  const idx = Math.max(0, defs.findIndex((d) => d.phases.includes(phase)));
  return defs.map((d, i) => {
    const state: StageState = job.phase === "COMPLETED" || i < idx ? "done" : i === idx ? (stopped ? "stopped" : "active") : "todo";
    return {
      id: d.id,
      title: d.title,
      doing: d.doing,
      state,
      percent: state === "done" ? 100 : state === "todo" ? 0 : stagePercent(d.id, job.counts),
      detail: state === "todo" ? "" : stageDetail(d.id, job.counts),
    };
  });
}

// ── What needs a look ──────────────────────────────────────────────────────────

export type IssueFix = { kind: "link"; label: string; href: string } | { kind: "sol"; label: string; prompt: string };
export interface Issue {
  id: string;
  /** "needs": fix it before going live. "look": worth a look, not urgent. */
  severity: "needs" | "look";
  title: string;
  /** Why, in plain words. */
  detail: string;
  fix: IssueFix;
}

const list = (items: string[], max = 3) => (items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", "));
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** Where "Ask SOL to fix" goes: SOL opens with the request already typed. */
export function solHref(prompt: string): string {
  return `/dashboard/sol?new=1&draft=${encodeURIComponent(prompt)}`;
}

function checklistFix(item: ChecklistItem, templateId: string, siteName: string): IssueFix {
  if (item.id === "payments") return { kind: "link", label: "Connect payments", href: `/dashboard/commerce/${templateId}/settings/payments` };
  if (item.id === "payments-other") return { kind: "link", label: "Open your shop", href: `/dashboard/commerce/${templateId}` };
  if (item.id === "team-access") return { kind: "link", label: "Invite your team", href: "/dashboard/settings/team" };
  return { kind: "sol", label: "Ask SOL to fix", prompt: `On my site "${siteName}", which I just moved from WordPress, please sort this out: ${item.label}. ${item.detail}` };
}

/** Everything in the report that wants a look, worst first, each with a plain reason and a fix. */
export function reportIssues(report: Report, templateId: string): Issue[] {
  const site = report.source.siteName || report.source.origin;
  const out: Issue[] = [];
  const rank = { blocked: 0, review: 1, todo: 2, done: 3 } as const;
  for (const c of [...report.checklist].sort((a, b) => rank[a.status] - rank[b.status])) {
    if (c.status === "done" || c.id === "publish" || c.id === "domain") continue;
    out.push({ id: `check:${c.id}`, severity: c.status === "blocked" ? "needs" : "look", title: c.label, detail: c.detail, fix: checklistFix(c, templateId, site) });
  }
  const failedPages = report.pages.filter((p) => p.status === "FAILED");
  if (failedPages.length) {
    out.push({
      id: "pages-failed", severity: "needs",
      title: `${failedPages.length} ${plural(failedPages.length, "page didn't", "pages didn't")} copy`,
      detail: `${list(failedPages.map((p) => p.title))}. WordPress may have been slow or the page is private.`,
      fix: { kind: "sol", label: "Ask SOL to fix", prompt: `On "${site}", these pages didn't copy from WordPress: ${list(failedPages.map((p) => p.title), 10)}. Please rebuild them.` },
    });
  }
  if (report.failedFiles.length) {
    out.push({
      id: "files-failed", severity: "look",
      title: `${report.failedFiles.length} ${plural(report.failedFiles.length, "picture or file didn't", "pictures and files didn't")} copy`,
      detail: `${list(report.failedFiles.map((f) => f.path.split("/").pop() || f.path))}. Visitors may see a gap where they were.`,
      fix: { kind: "sol", label: "Ask SOL to fix", prompt: `On "${site}", these files didn't copy from WordPress: ${list(report.failedFiles.map((f) => f.path), 8)}. Please help me replace them.` },
    });
  }
  if (report.brokenLinks.length) {
    out.push({
      id: "links-broken", severity: "look",
      title: `${report.brokenLinks.length} ${plural(report.brokenLinks.length, "link leads", "links lead")} nowhere`,
      detail: `For example ${report.brokenLinks[0].href} on ${report.brokenLinks[0].from}. ${report.brokenLinks[0].reason}`,
      fix: { kind: "sol", label: "Ask SOL to fix", prompt: `On "${site}", fix these broken links: ${list(report.brokenLinks.map((l) => `${l.href} (on ${l.from})`), 8)}.` },
    });
  }
  for (const p of report.plugins.filter((x) => x.outcome === "NEEDS_ATTENTION")) {
    out.push({ id: `plugin:${p.slug}`, severity: "look", title: `${p.name} needs a look`, detail: p.explanation, fix: { kind: "sol", label: "Ask SOL to fix", prompt: `On "${site}", I used the WordPress plugin "${p.name}". ${p.explanation} Please recreate what it did.` } });
  }
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true))).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "needs" ? -1 : 1));
}

export interface ReportSummary {
  pages: number; posts: number; pictures: number; forms: number; products: number | null; menus: boolean;
}

/** The "what moved" numbers, for the stat cards. */
export function reportSummary(report: Report): ReportSummary {
  return {
    pages: report.summary.pagesCopied,
    posts: report.summary.postsCopied,
    pictures: report.summary.filesCopied,
    forms: report.summary.formsReconnected,
    products: report.summary.productsMoved ?? null,
    menus: report.summary.pagesCopied > 0,
  };
}

/** The blog's address and a plain status line ("42 posts, at /blog"). */
export function blogStatus(report: Report): { posts: number; path: string; line: string } {
  const posts = report.summary.postsCopied;
  return { posts, path: "/blog", line: posts === 0 ? "No blog posts on this site." : `${n(posts)} ${plural(posts, "post is", "posts are")} in your blog, which opens at /blog.` };
}

// ── Start screen + domain step ─────────────────────────────────────────────────

/** A friendly message when what's typed can't be a web address yet; null when it looks fine (or is empty). */
export function addressProblem(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/\s/.test(v)) return "Web addresses don't have spaces. Try something like yourwebsite.com.";
  if (/^[^/]*@/.test(v)) return "That looks like an email address. We need your website's address, like yourwebsite.com.";
  const host = v.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(host)) return "That doesn't look like a web address yet. Try something like yourwebsite.com.";
  return null;
}

export type PillTone = "success" | "warning" | "danger" | "neutral";
/** The words and colour for a domain check, in plain language. */
export function checkPill(status: "done" | "blocked" | "review" | "todo"): { label: string; tone: PillTone } {
  if (status === "done") return { label: "All set", tone: "success" };
  if (status === "blocked") return { label: "Needs a change", tone: "danger" };
  if (status === "review") return { label: "Have a look", tone: "warning" };
  return { label: "Waiting", tone: "neutral" };
}

/** Free sites can't move in; the plain-words reason and where to go. */
export function planGate(canMove: boolean): { title: string; body: string } | null {
  return canMove ? null : { title: "Moving a site comes with Starter and Pro", body: "Pick a plan and you can move your whole WordPress site across, pictures and blog included. Free accounts can still build a new site from scratch." };
}
