import { describe, expect, it } from "vitest";
import { canLink, confirmationText, NO_SELECTION, PICKER_COPY, projectInitial, selectionToChoice, sortProjects, stageFor, toggleSelection, type PickerProject } from "@/lib/dashboardV3/strataPicker";

const P = (id: string, name: string, extra: Partial<PickerProject> = {}): PickerProject => ({ id, name, ...extra });

describe("stageFor: the picker is honest about where it is", () => {
  const base = { available: true, connected: true, loading: false, error: null, projects: [P("a", "A")] };
  it("unavailable when Strata isn't set up on this Plexo", () => expect(stageFor({ ...base, available: false })).toBe("unavailable"));
  it("loading until availability is known, and while loading", () => {
    expect(stageFor({ ...base, available: null })).toBe("loading");
    expect(stageFor({ ...base, loading: true })).toBe("loading");
  });
  it("not connected is its own simple step", () => expect(stageFor({ ...base, connected: false })).toBe("not-connected"));
  it("an error with a connection shows the error", () => expect(stageFor({ ...base, error: "x" })).toBe("error"));
  it("no projects is the empty state, some is the list", () => {
    expect(stageFor({ ...base, projects: [] })).toBe("empty");
    expect(stageFor({ ...base, projects: null })).toBe("empty");
    expect(stageFor(base)).toBe("list");
  });
});

describe("the list", () => {
  it("puts the project in use first, view-only ones last, then newest", () => {
    const list = [P("old", "Old", { updatedAt: "2026-01-01" }), P("view", "View", { role: "viewer", updatedAt: "2026-12-01" }), P("new", "New", { updatedAt: "2026-06-01" }), P("cur", "Current", { updatedAt: "2025-01-01" })];
    expect(sortProjects(list, "cur").map((p) => p.id)).toEqual(["cur", "new", "old", "view"]);
  });
  it("a viewer can't link (Strata needs edit access)", () => {
    expect(canLink(P("a", "A", { role: "viewer" }))).toBe(false);
    expect(canLink(P("a", "A", { role: "editor" }))).toBe(true);
    expect(canLink(P("a", "A"))).toBe(true);
  });
  it("shows a letter when there is no logo", () => {
    expect(projectInitial("  ama's kitchen")).toBe("A");
    expect(projectInitial("")).toBe("S");
    expect(projectInitial("42 brand")).toBe("4");
  });
});

describe("choices", () => {
  it("a project or 'create from my brand' becomes a request; skipping and nothing do not", () => {
    expect(selectionToChoice({ kind: "project", id: "p1", name: "Ama" })).toEqual({ projectId: "p1", projectName: "Ama" });
    expect(selectionToChoice({ kind: "create" })).toEqual({ createFromBrand: true });
    expect(selectionToChoice({ kind: "skip" })).toBeUndefined();
    expect(selectionToChoice(NO_SELECTION)).toBeUndefined();
  });
  it("choosing the same thing again clears it; choosing another replaces it", () => {
    const a = { kind: "project", id: "a", name: "A" } as const;
    expect(toggleSelection(a, a)).toEqual(NO_SELECTION);
    expect(toggleSelection(a, { kind: "project", id: "b", name: "B" })).toEqual({ kind: "project", id: "b", name: "B" });
    expect(toggleSelection({ kind: "create" }, { kind: "create" })).toEqual(NO_SELECTION);
    expect(toggleSelection(a, { kind: "create" })).toEqual({ kind: "create" });
  });
});

describe("words", () => {
  it("never shows jargon to a beginner", () => {
    const all = JSON.stringify(PICKER_COPY);
    expect(all).not.toMatch(/token|MCP|API|SQL|JSON|webhook|GitHub/i);
  });
  it("confirms in one plain sentence", () => {
    expect(confirmationText({ projectName: "Ama's brand", autoSync: true })).toBe('Your "Ama\'s brand" brand is on your website. It stays in step when you publish in Strata.');
    expect(confirmationText({ projectName: "Ama", created: true, autoSync: false, notes: ["Your logo wasn't sent to Strata; add it there when you like."] })).toBe('Your brand is now in Strata as "Ama" and on your website. Your logo wasn\'t sent to Strata; add it there when you like.');
  });
});
