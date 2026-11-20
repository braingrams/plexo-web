import { describe, expect, it, vi } from "vitest";
import { creditNote, runOnPages, summarizeRun, undoableStates, type RunDeps } from "@/lib/ai/multiPageRun";

const pages = [{ pageId: "a", name: "Home" }, { pageId: "b", name: "About" }, { pageId: "c", name: "Contact" }];
const deps = (over: Partial<RunDeps> = {}): RunDeps => ({
  loadPage: async (pageId) => ({ pageId, name: pageId }),
  ask: async () => "ok",
  parse: () => ({ text: "Done it", commands: [{ op: "x" }] }),
  apply: async () => ({ saved: true, message: "Changed.", before: { v: 1 } }),
  isOutOfCredits: (r) => /credits/.test(r),
  ...over,
});

describe("runOnPages", () => {
  it("does every page in order and reports progress for each", async () => {
    const seen: string[] = [];
    const out = await runOnPages({ pages, question: "q", deps: deps({ ask: async ({ page }) => (seen.push(page.pageId), "ok") }), onProgress: () => {} });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(out.map((s) => s.status)).toEqual(["done", "done", "done"]);
    expect(out[0].before).toEqual({ v: 1 });
  });
  it("skips pages SOL can't change and carries on", async () => {
    const out = await runOnPages({ pages, question: "q", deps: deps({ loadPage: async (id) => (id === "b" ? { pageId: id, name: id, skipped: "Hand-written code" } : { pageId: id, name: id }) }), onProgress: () => {} });
    expect(out.map((s) => s.status)).toEqual(["done", "skipped", "done"]);
    expect(out[1].note).toBe("Hand-written code");
  });
  it("stops cleanly when credits run out and says the rest were not started", async () => {
    let n = 0;
    const out = await runOnPages({ pages, question: "q", deps: deps({ ask: async () => (++n === 2 ? "You don't have enough credits" : "ok") }), onProgress: () => {} });
    expect(out.map((s) => s.status)).toEqual(["done", "no-credits", "no-credits"]);
    expect(out[2].note).toContain("out of AI credits");
  });
  it("one failing page does not stop the others", async () => {
    const out = await runOnPages({ pages, question: "q", deps: deps({ apply: vi.fn().mockRejectedValueOnce(new Error("Couldn't save")).mockResolvedValue({ saved: true, message: "", before: null }) }), onProgress: () => {} });
    expect(out.map((s) => s.status)).toEqual(["failed", "done", "done"]);
    expect(out[0].note).toBe("Couldn't save");
  });
  it("marks pages with no changes as left alone", async () => {
    const out = await runOnPages({ pages: [pages[0]], question: "q", deps: deps({ parse: () => ({ text: "Looks fine already", commands: null }) }), onProgress: () => {} });
    expect(out[0]).toMatchObject({ status: "nothing", said: "Looks fine already" });
  });
  it("can be cancelled between pages", async () => {
    const c = new AbortController();
    const out = await runOnPages({ pages, question: "q", signal: c.signal, deps: deps({ ask: async () => { c.abort(); return "ok"; } }), onProgress: () => {} });
    expect(out.map((s) => s.status)).toEqual(["done", "cancelled", "cancelled"]);
  });
  it("sends progress snapshots that don't change afterwards", async () => {
    const snaps: string[][] = [];
    await runOnPages({ pages: [pages[0]], question: "q", deps: deps(), onProgress: (s) => snaps.push(s.map((x) => x.status)) });
    expect(snaps).toEqual([["working"], ["done"]]);
  });
});

describe("wording", () => {
  it("summarises in plain words", async () => {
    const out = await runOnPages({ pages, question: "q", deps: deps({ loadPage: async (id) => (id === "b" ? { pageId: id, name: id, skipped: "x" } : { pageId: id, name: id }) }), onProgress: () => {} });
    expect(summarizeRun(out)).toBe("2 pages changed, 1 skipped");
    expect(undoableStates(out)).toHaveLength(2);
    expect(summarizeRun([])).toBe("No pages were changed");
  });
  it("explains the credit cost, or that none is used with an own key", () => {
    expect(creditNote({ paidBy: "own-key", total: 0, balance: null, perPage: [] })).toContain("own AI key");
    expect(creditNote({ paidBy: "plexo", total: 12.2, balance: 300, perPage: [4, 8] })).toBe("Uses up to about 13 AI credits (usually less). You have 300.");
    expect(creditNote(null)).toBe("");
  });
});
