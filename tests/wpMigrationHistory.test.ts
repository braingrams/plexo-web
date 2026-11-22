import { describe, expect, it } from "vitest";
import { buildHistories, closeLatestRun, describeRerun, movedSentence, outcomeOf, stepsFor, withNewRun, type JobLike } from "@/lib/wpMigration/history";

const job = (o: Partial<JobLike> & { id: string }): JobLike => ({ templateId: "t1", sourceUrl: "https://a.org", phase: "COMPLETED", createdAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T01:00:00Z", counts: { pagesDone: 4, postsDone: 1, assetsDone: 9 }, movedLinks: { "/x": "/y" }, ...o });

describe("wp migration history", () => {
  it("reads a job as its first run", () => {
    const [h] = buildHistories([job({ id: "j1" })]);
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]).toMatchObject({ number: 1, outcome: "completed", scope: "all", redirects: 1 });
    expect(movedSentence(h.runs[0])).toBe("4 pages, 1 blog post, 9 pictures and files, 1 redirect");
  });
  it("lists re-runs newest first and keeps the first run's own snapshot", () => {
    const j = job({ id: "j1" });
    const runs = closeLatestRun(withNewRun(j, { id: "r2", startedAt: "2026-02-01T00:00:00Z", scope: "POSTS", outcome: "running" }), { outcome: "completed", finishedAt: "2026-02-01T00:10:00Z", counts: { postsDone: 5 } });
    const [h] = buildHistories([{ ...j, counts: { postsDone: 5 }, runs }]);
    expect(h.runs.map((r) => [r.number, r.scope])).toEqual([[2, "POSTS"], [1, "all"]]);
    expect(h.runs[1].counts?.pagesDone).toBe(4);
    expect(h.active).toBe(false);
  });
  it("flags an unfinished newest run as active and groups sites apart", () => {
    const hs = buildHistories([job({ id: "j1" }), job({ id: "j2", templateId: "t2", phase: "POSTS", createdAt: "2026-03-01T00:00:00Z" })]);
    expect(hs).toHaveLength(2);
    expect(hs[0].templateId).toBe("t2");
    expect(hs[0].active).toBe(true);
  });
  it("says what a re-run will do in plain words", () => {
    const p = describeRerun("POSTS", { posts: 3 }, "https://a.org/");
    expect(p.willDo).toContain("3 blog posts");
    expect(p.willDo).toContain("a.org");
    expect(p.willReplace).toMatch(/Posts you've changed/);
    expect(stepsFor({ products: 0 })).not.toContain("PRODUCTS");
    expect(stepsFor({ products: 2 })).toContain("PRODUCTS");
    expect(outcomeOf("PAUSED_ERROR")).toBe("paused");
  });
});
