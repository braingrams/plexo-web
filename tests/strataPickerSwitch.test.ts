import { describe, expect, it } from "vitest";
import { needsSwitchConfirmation, switchWarning } from "@/lib/dashboardV3/strataPicker";

describe("switching the brand a website follows", () => {
  it("asks first when the site already follows a different brand, or a new one would be made", () => {
    expect(needsSwitchConfirmation({ currentProjectId: "a", selection: { kind: "project", id: "b", name: "B" } })).toBe(true);
    expect(needsSwitchConfirmation({ currentProjectId: "a", selection: { kind: "create" } })).toBe(true);
  });
  it("does not ask for the first brand, the same brand, or when nothing is chosen", () => {
    expect(needsSwitchConfirmation({ currentProjectId: null, selection: { kind: "project", id: "b", name: "B" } })).toBe(false);
    expect(needsSwitchConfirmation({ currentProjectId: "a", selection: { kind: "project", id: "a", name: "A" } })).toBe(false);
    expect(needsSwitchConfirmation({ currentProjectId: "a", selection: { kind: "skip" } })).toBe(false);
  });
  it("says in plain words what will change and what will not", () => {
    const w = switchWarning({ siteName: "Allegro", toName: "Plexo", autoSync: true });
    expect(w.title).toBe('Switch Allegro\'s brand to "Plexo"?');
    expect(w.lines.join(" ")).toContain("colours, fonts and logo");
    expect(w.lines.join(" ")).toContain("Your words, pictures and pages stay exactly as they are");
    expect(w.lines.join(" ")).toContain("follows this brand");
    expect(switchWarning({ siteName: "Allegro", toName: "X", autoSync: false }).lines.join(" ")).toContain("will not follow later changes");
  });
});
