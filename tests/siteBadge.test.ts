import { describe, expect, it } from "vitest";
import { resolveSiteHideBranding, siteBadgeChoice, siteFlagFromChoice } from "@/lib/subscription";

const PAID = "STARTER";
const FREE = "FREE";

describe("the Plexo badge, per site", () => {
  it("a site with no choice follows the account", () => {
    expect(resolveSiteHideBranding(PAID, true, undefined)).toBe(true);
    expect(resolveSiteHideBranding(PAID, false, undefined)).toBe(false);
    expect(resolveSiteHideBranding(PAID, true, null)).toBe(true);
  });
  it("account hides it, one site shows it: only that site shows it", () => {
    const sites = [undefined, undefined, undefined, undefined, false];
    expect(sites.map((s) => resolveSiteHideBranding(PAID, true, s))).toEqual([true, true, true, true, false]);
  });
  it("account shows it, one site hides it: only that site hides it", () => {
    const sites = [undefined, undefined, undefined, undefined, true];
    expect(sites.map((s) => resolveSiteHideBranding(PAID, false, s))).toEqual([false, false, false, false, true]);
  });
  it("hiding still needs a plan that includes it, whichever level asked", () => {
    expect(resolveSiteHideBranding(FREE, true, undefined)).toBe(false);
    expect(resolveSiteHideBranding(FREE, false, true)).toBe(false);
  });
  it("maps the three dashboard words to what is stored and back", () => {
    expect(siteFlagFromChoice("account")).toBeNull();
    expect(siteFlagFromChoice("show")).toBe(false);
    expect(siteFlagFromChoice("hide")).toBe(true);
    expect(siteBadgeChoice(undefined)).toBe("account");
    expect(siteBadgeChoice(false)).toBe("show");
    expect(siteBadgeChoice(true)).toBe("hide");
  });
});
