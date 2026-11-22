import { describe, expect, it } from "vitest";
import { describePlace } from "@/lib/onboarding/place";

describe("describePlace", () => {
  it("prefers the real city and country from the network edge", () => {
    expect(describePlace({ city: "Lagos", country: "Nigeria", timeZone: "Europe/London", locale: "en-GB" })).toBe("Lagos, Nigeria");
  });
  it("uses the country alone when there is no city", () => {
    expect(describePlace({ country: "Nigeria" })).toBe("Nigeria");
  });
  it("falls back to the browser's time zone and region", () => {
    expect(describePlace({ timeZone: "Africa/Lagos", locale: "en-NG" })).toBe("time zone Africa/Lagos, browser region NG");
  });
  it("says nothing when nothing is known, and ignores junk", () => {
    expect(describePlace({})).toBeUndefined();
    expect(describePlace({ city: "<script>alert(1)</script>", country: "" })).toBeUndefined();
  });
});
