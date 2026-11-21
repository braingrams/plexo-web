import { describe, expect, it } from "vitest";
import { addOnsFor, hubKindLabel, hubTabs, NO_FEATURES, resolveHubTab } from "@/lib/dashboardV3/hubTabs";

const ids = (f = NO_FEATURES, e: "beginner" | "intermediate" | "pro" = "beginner") => hubTabs(f, e).map((t) => t.id);

describe("hub tabs per kind", () => {
  it("a plain website gets Pages, Brand, Web address, Visits, Site health, Settings, More", () => {
    expect(ids()).toEqual(["pages", "brand", "address", "visits", "health", "settings", "more"]);
  });
  it("a server app swaps Pages for App and drops tabs that cannot work for it", () => {
    const f = { ...NO_FEATURES, deployed: "server" as const };
    expect(ids(f, "pro")).toEqual(["app", "address", "visits", "health", "settings", "more", "advanced"]);
    expect(ids(f, "beginner")).toEqual(["app", "address", "visits", "health", "settings", "more"]);
    for (const dropped of ["pages", "products", "orders", "blog", "course", "brand"]) expect(ids(f, "pro")).not.toContain(dropped);
  });
  it("a static uploaded app gets the same App tab", () => {
    expect(ids({ ...NO_FEATURES, deployed: "static" })[0]).toBe("app");
  });
  it("lands on the App tab by default, and ignores tabs the kind does not have", () => {
    const f = { ...NO_FEATURES, deployed: "server" as const };
    expect(resolveHubTab(undefined, f, "pro")).toBe("app");
    expect(resolveHubTab("products", f, "pro")).toBe("app");
    expect(resolveHubTab("visits", f, "pro")).toBe("visits");
  });
  it("labels the kind in plain words", () => {
    expect(hubKindLabel({ ...NO_FEATURES, deployed: "server" })).toBe("Server app");
    expect(hubKindLabel({ ...NO_FEATURES, deployed: "static" })).toBe("Uploaded app");
    expect(hubKindLabel({ ...NO_FEATURES, store: true })).toBe("Online store");
  });
  it("resolves shop tab when store or donations or migrated is enabled, but not for plain websites without them", () => {
    expect(resolveHubTab("shop", NO_FEATURES)).toBe("pages");
    expect(resolveHubTab("shop", { ...NO_FEATURES, store: true })).toBe("shop");
    expect(resolveHubTab("shop", { ...NO_FEATURES, donations: true })).toBe("shop");
    expect(resolveHubTab("shop", { ...NO_FEATURES, migrated: true })).toBe("shop");
    expect(resolveHubTab("shop", { ...NO_FEATURES, deployed: "server", donations: true })).toBe("app");
  });
  it("a site with donations enabled gets a dedicated donations tab", () => {
    expect(ids({ ...NO_FEATURES, donations: true })).toContain("donations");
    expect(resolveHubTab("donations", { ...NO_FEATURES, donations: true })).toBe("donations");
  });
  it("shows donations add-on when donations are not yet turned on, and hides when enabled", () => {
    const withoutDonations = addOnsFor(NO_FEATURES).map((a) => a.id);
    expect(withoutDonations).toContain("donations");
    const withDonations = addOnsFor({ ...NO_FEATURES, donations: true }).map((a) => a.id);
    expect(withDonations).not.toContain("donations");
  });
});
