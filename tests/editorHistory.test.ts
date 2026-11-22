import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, JOIN_WITHIN_MS, canRedo, canUndo, createHistory, current, rebase, record, redo, undo } from "@/lib/editorModes/history";

describe("page history", () => {
  it("undoes and redoes across several kinds of change", () => {
    let h = createHistory("a");
    h = record(h, "b", { now: 1000 }); // e.g. a click in Design
    h = record(h, "c", { now: 5000 }); // e.g. typing in Code
    expect(current(h)).toBe("c");
    h = undo(h);
    expect(current(h)).toBe("b");
    h = undo(h);
    expect(current(h)).toBe("a");
    expect(canUndo(h)).toBe(false);
    h = redo(redo(h));
    expect(current(h)).toBe("c");
    expect(canRedo(h)).toBe(false);
  });
  it("joins a burst of typing into one step but not slow edits", () => {
    let h = createHistory("");
    h = record(h, "h", { now: 1000 });
    h = record(h, "he", { now: 1200, join: true });
    h = record(h, "hel", { now: 1400, join: true });
    expect(h.entries).toEqual(["", "hel"]);
    h = record(h, "hell", { now: 1400 + JOIN_WITHIN_MS + 1, join: true });
    expect(h.entries).toEqual(["", "hel", "hell"]);
  });
  it("never joins into the starting page", () => {
    let h = createHistory("start");
    h = record(h, "start!", { now: 10, join: true });
    expect(h.entries).toEqual(["start", "start!"]);
  });
  it("drops what could be redone when something new is written", () => {
    let h = record(record(createHistory("a"), "b", { now: 1 }), "c", { now: 2 });
    h = undo(h);
    h = record(h, "d", { now: 3 });
    expect(h.entries).toEqual(["a", "b", "d"]);
    expect(canRedo(h)).toBe(false);
  });
  it("ignores writing the same page again", () => {
    const h = createHistory("a");
    expect(record(h, "a", { now: 1 })).toBe(h);
  });
  it("keeps a bounded number of steps", () => {
    let h = createHistory("0");
    for (let i = 1; i <= HISTORY_LIMIT + 30; i++) h = record(h, String(i), { now: i * 5000 });
    expect(h.entries.length).toBe(HISTORY_LIMIT);
    expect(current(h)).toBe(String(HISTORY_LIMIT + 30));
    expect(h.index).toBe(HISTORY_LIMIT - 1);
  });
  it("undo and redo at the ends do nothing", () => {
    const h = createHistory("a");
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
  it("a reload that brings new content is a step you can undo", () => {
    const h = rebase(createHistory("a"), "b", 1);
    expect(current(undo(h))).toBe("a");
  });
});
