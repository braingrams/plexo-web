import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, shouldAskCountry, countryName, countryOptions, normalizeCountryCode, regionOfCountry } from "@/lib/countries";

describe("countries", () => {
  it("validates ISO codes", () => {
    expect(normalizeCountryCode(" ng ")).toBe("NG");
    for (const bad of ["", "XX", "T1", "NGA", "1A", null, 5, "ZZ"]) expect(normalizeCountryCode(bad)).toBeNull();
    expect(COUNTRY_CODES.length).toBeGreaterThan(230);
  });
  it("names and groups countries", () => {
    expect(countryName("NG")).toBe("Nigeria");
    expect(countryName(null)).toBe("Unknown");
    expect(regionOfCountry("GH")).toBe("Africa");
    expect(regionOfCountry("GB")).toBe("Europe");
    expect(countryOptions().every((c) => regionOfCountry(c.code))).toBe(true);
  });
});

describe("shouldAskCountry", () => {
  it("asks everyone with no country, every time, until they pick one", () => {
    expect(shouldAskCountry({})).toBe(true);
    expect(shouldAskCountry({ country: "" })).toBe(true);
    // An old "Later" from before the prompt became required no longer holds it back.
    expect(shouldAskCountry({ countryAskedAt: new Date().toISOString() })).toBe(true);
    expect(shouldAskCountry({ country: "NG" })).toBe(false);
  });
});
