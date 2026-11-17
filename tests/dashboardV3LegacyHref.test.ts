import { describe, expect, it } from "vitest";
import { toHubHref } from "@/lib/dashboardV3/legacyHref";

describe("toHubHref", () => {
  it("sends the old app details page to the site's App tab", () => {
    expect(toHubHref("/dashboard/templates/abc/detail")).toBe("/dashboard/sites/abc?tab=app");
    expect(toHubHref("/dashboard/templates/abc/detail?tab=server")).toBe("/dashboard/sites/abc?tab=app");
    expect(toHubHref("/dashboard/apps/xyz")).toBe("/dashboard/sites/xyz?tab=app");
  });
  it("leaves every other address alone", () => {
    expect(toHubHref("/dashboard/templates/abc/blog")).toBe("/dashboard/templates/abc/blog");
    expect(toHubHref("https://example.com")).toBe("https://example.com");
  });
});
