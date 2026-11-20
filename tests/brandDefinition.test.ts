import { describe, expect, it } from "vitest";
import { BRAND_COPY, BRAND_PRESETS, DENSITY, HELP_COPY, ROUNDNESS, draftFromBrand, nearestRoundness, readBrandTokens, saveStatusText, tokenRequestFromDraft } from "@/lib/dashboardV3/brandDefinition";
import { planTokenChanges } from "@/lib/brand/brandModel";
import { findFont } from "@/lib/fonts/catalogue";

describe("Your brand definition (pure)", () => {
  it("starts from what the brand holds, with gentle defaults for the rest", () => {
    const d = draftFromBrand({ colours: [{ role: "primary", value: "#e4572e" }, { role: "accent", value: "#1F6FEB" }], fonts: { heading: "Lora" }, radius: "15px" });
    expect(d).toMatchObject({ primary: "#E4572E", accent: "#1F6FEB", secondary: "", headingFont: "Lora", bodyFont: "Inter", roundness: "round" });
    expect(draftFromBrand(null).primary).toMatch(/^#[0-9A-F]{6}$/);
  });
  it("snaps any corner size to the nearest friendly choice", () => {
    expect(nearestRoundness("0px")).toBe("sharp");
    expect(nearestRoundness(30)).toBe("extra");
    expect(nearestRoundness(undefined)).toBe("soft");
  });
  it("every style preset is a complete, valid brand", () => {
    for (const p of BRAND_PRESETS) {
      expect(findFont(p.draft.headingFont)).toBeTruthy();
      expect(findFont(p.draft.bodyFont)).toBeTruthy();
      for (const c of [p.draft.primary, p.draft.secondary, p.draft.accent]) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
  it("turns a draft into token changes the brand accepts, with nothing skipped", () => {
    for (const p of BRAND_PRESETS) {
      const req = tokenRequestFromDraft(p.draft);
      const plan = planTokenChanges([], req);
      expect(plan.skipped).toEqual([]);
      expect(plan.sent).toEqual(expect.arrayContaining(["heading font", "body font", "accent colour"]));
    }
    expect(ROUNDNESS.map((r) => r.px)).toEqual([0, 8, 16, 28]);
    expect(DENSITY.map((d) => d.steps["4"])).toEqual([12, 16, 20]);
  });
  it("leaves a blank accent alone", () => {
    expect(tokenRequestFromDraft({ ...BRAND_PRESETS[0].draft, accent: "" }).colours).toEqual({});
  });
  it("reads saved choices defensively", () => {
    expect(readBrandTokens("nope")).toBeNull();
    expect(readBrandTokens({ colours: { accent: "e4572e", primary: "zzz" }, fonts: { heading: 3, body: "Inter" }, radius: 12, spacing: { "4": 16, x: {} } })).toEqual({ colours: { accent: "#E4572E" }, fonts: { body: "Inter" }, radius: 12, spacing: { "4": 16 } });
  });
  it("says saved plainly", () => {
    expect(saveStatusText("saved")).toBe("Saved");
    expect(saveStatusText("waiting")).toMatch(/finishing/i);
    expect(BRAND_COPY.pageTitle).toBe("Your brand");
    expect(BRAND_COPY.definitionTitle).toBe("Your brand definition");
  });
  it("names the tool only in the help text, for all three audiences", () => {
    expect(JSON.stringify(BRAND_COPY)).not.toMatch(/strata/i);
    expect(HELP_COPY.newcomer.text).toMatch(/colours, fonts and logo/);
    expect(HELP_COPY.strataUser.text).toMatch(/your own Strata account/);
    expect(HELP_COPY.designer.text).toMatch(/design tokens/);
    expect(HELP_COPY.designer.link).toBe("Try Strata");
  });
});
