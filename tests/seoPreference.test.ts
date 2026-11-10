import { describe, it, expect } from "vitest";
import { seoToolsEnabledFrom } from "@/app/dashboard/templates/[id]/blog/seoPreference";

describe("seoToolsEnabledFrom", () => {
  it("is on when nothing is stored", () => {
    expect(seoToolsEnabledFrom(null)).toBe(true);
  });
  it("is off only for an explicit off", () => {
    expect(seoToolsEnabledFrom("off")).toBe(false);
    expect(seoToolsEnabledFrom("on")).toBe(true);
    expect(seoToolsEnabledFrom("anything-else")).toBe(true);
  });
});
