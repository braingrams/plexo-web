import { describe, expect, it } from "vitest";
import { addressProblem, blogStatus, checkPill, movePercent, moveStages, planGate, reportIssues, solHref } from "@/lib/wpMigration/moveView";
import type { Counts, Report } from "@/app/dashboard/migrate/wordpress/wizard/types";

const counts = (o: Partial<Counts> = {}): Counts => ({ pages: 10, pagesDone: 0, pagesFailed: 0, posts: 20, postsDone: 0, postsFailed: 0, assets: 100, assetsDone: 0, assetsFailed: 0, assetsSkipped: 0, ...o });

describe("move progress", () => {
  it("maps server phases onto five stages", () => {
    const s = moveStages({ phase: "PAGES", pausedIn: null, counts: counts({ pagesDone: 5, posts: 20, postsDone: 20 }) });
    expect(s.map((x) => x.state)).toEqual(["done", "done", "active", "todo", "todo"]);
    expect(s[2].detail).toBe("5 of 10 pages");
    expect(s[2].percent).toBe(50);
    expect(s[3].detail).toBe("");
  });
  it("marks the stopped stage when paused", () => {
    const s = moveStages({ phase: "PAUSED_ERROR", pausedIn: "ASSETS", counts: counts() });
    expect(s.map((x) => x.state)).toEqual(["done", "done", "done", "stopped", "todo"]);
  });
  it("PENDING counts as finding pages; completed is all done", () => {
    expect(moveStages({ phase: "PENDING", pausedIn: null, counts: null })[0].state).toBe("active");
    expect(moveStages({ phase: "COMPLETED", pausedIn: null, counts: null }).every((x) => x.state === "done")).toBe(true);
  });
  it("combines posts and products in the content stage", () => {
    const s = moveStages({ phase: "POSTS", pausedIn: null, counts: counts({ postsDone: 10, products: 10, productsDone: 0 }) });
    expect(s[1].detail).toBe("10 of 20 blog posts · 0 of 10 products");
    expect(s[1].percent).toBe(33);
  });
  it("overall percent rises with each phase and finishes at 100", () => {
    const at = (phase: string, c: Counts | null = counts()) => movePercent({ phase, pausedIn: null, counts: c });
    expect(at("PLANNING", null)).toBe(0);
    expect(at("POSTS")).toBeLessThan(at("PAGES"));
    expect(at("PAGES")).toBeLessThan(at("ASSETS"));
    expect(at("ASSETS", counts({ assetsDone: 100 }))).toBeCloseTo(94.44, 1);
    expect(at("COMPLETED")).toBe(100);
  });
});

const report = (o: Partial<Report> = {}): Report => ({
  source: { origin: "https://ama.com", homeUrl: "https://ama.com/", siteName: "Ama" },
  summary: { pagesCopied: 8, pagesFailed: 0, postsCopied: 12, postsFailed: 0, filesCopied: 90, filesFailed: 0, filesAlreadyMissing: 0, bytesCopied: 1, formsReconnected: 1 },
  seo: { pagesChecked: 8, titles: 8, descriptions: 8, canonicals: 8, structuredData: 8, robots: 8 },
  pages: [], forms: [], brokenLinks: [], failedFiles: [], missingOnSource: [], plugins: [], checklist: [], readyForCutover: true, ...o,
});

describe("report issues", () => {
  it("is empty for a clean report", () => expect(reportIssues(report(), "t1")).toEqual([]));
  it("groups failures, puts blockers first, and gives each a fix", () => {
    const issues = reportIssues(report({
      checklist: [
        { id: "payments", label: "Fix payments", status: "blocked", detail: "x" },
        { id: "seo", label: "Check titles", status: "review", detail: "y" },
        { id: "domain", label: "Domain", status: "todo", detail: "z" },
      ],
      pages: [{ key: "a", kind: "PAGE", title: "About", sourceUrl: "", newPath: null, status: "FAILED", error: "x", seo: null }, { key: "b", kind: "PAGE", title: "Team", sourceUrl: "", newPath: null, status: "FAILED", error: "x", seo: null }],
      brokenLinks: [{ from: "/a", href: "/gone", reason: "Page not found." }],
      failedFiles: [{ path: "/uploads/a.png", reason: "x" }],
      plugins: [{ slug: "p", name: "Slider", outcome: "NEEDS_ATTENTION", explanation: "Recreate it." }],
    }), "t1");
    expect(issues.map((i) => i.id)).toEqual(["check:payments", "pages-failed", "check:seo", "files-failed", "links-broken", "plugin:p"]);
    expect(issues[0].fix).toMatchObject({ kind: "link", href: "/dashboard/commerce/t1/settings/payments" });
    expect(issues[1].title).toBe("2 pages didn't copy");
    expect(issues.every((i) => i.fix.label)).toBe(true);
  });
  it("builds a SOL link with the request typed in", () => {
    expect(solHref("fix it & go")).toBe("/dashboard/sol?new=1&draft=fix%20it%20%26%20go");
  });
  it("describes the blog at /blog", () => {
    expect(blogStatus(report()).line).toContain("/blog");
    expect(blogStatus(report({ summary: { ...report().summary, postsCopied: 1 } })).line).toContain("1 post is");
  });
});

describe("start screen helpers", () => {
  it("accepts normal addresses and stays quiet while empty", () => {
    for (const ok of ["", "ama.com", "https://www.ama.com/blog", "http://ama.co.uk/wp/"]) expect(addressProblem(ok)).toBeNull();
  });
  it("explains what's wrong in plain words", () => {
    expect(addressProblem("my site")).toMatch(/spaces/);
    expect(addressProblem("ama@ama.com")).toMatch(/email/);
    expect(addressProblem("amacom")).toMatch(/web address/);
  });
  it("maps domain checks to pills and gates free accounts", () => {
    expect(checkPill("done")).toEqual({ label: "All set", tone: "success" });
    expect(checkPill("todo").tone).toBe("neutral");
    expect(planGate(true)).toBeNull();
    expect(planGate(false)?.title).toMatch(/Starter and Pro/);
  });
});
