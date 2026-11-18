import { describe, expect, it } from "vitest";
import { HUB_SECTION_FOR_PANEL } from "@/lib/dashboardV3/appEditorLinks";
import { advancedHref, advancedSections } from "@/lib/dashboardV3/hubAdvanced";

describe("the app editor links to the app's own page", () => {
  it("every linked section really exists there for a full-view owner, so no link is a dead end", () => {
    const have = new Set(advancedSections({ kind: "app", experience: "pro" }).map((s) => s.id));
    for (const [panel, section] of Object.entries(HUB_SECTION_FOR_PANEL)) expect(have.has(section), panel).toBe(true);
  });

  it("builds the address the app's page understands", () => {
    expect(advancedHref("abc", HUB_SECTION_FOR_PANEL.people)).toBe("/dashboard/sites/abc?tab=advanced&section=users");
  });
});
