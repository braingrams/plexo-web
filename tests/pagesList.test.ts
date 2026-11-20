import { describe, expect, it } from "vitest";
import { canEditAs, editViewHref, filterPages, liveUrl, pageLabel, parseEditMode, relativeTime, sortPages } from "@/lib/dashboardV3/pagesList";
import type { HubPage } from "@/lib/dashboardV3/hubData";

const p = (o: Partial<HubPage>): HubPage => ({ id: "a", name: "Page", slug: "page", path: "/page", isRoot: false, parentId: "r", order: 0, isPublished: true, archivedByPlan: false, sourceType: "BUILDER", updatedAt: "2026-01-01T00:00:00Z", ...o });

describe("pagesList", () => {
  const pages = [p({ id: "1", name: "About us", path: "/about" }), p({ id: "2", name: "Contact", path: "/contact", isPublished: false }), p({ id: "3", name: "Zebra", path: "/zoo", updatedAt: "2026-03-01T00:00:00Z" })];
  it("searches title and address", () => {
    expect(filterPages(pages, "abo", "all").map((x) => x.id)).toEqual(["1"]);
    expect(filterPages(pages, "/zoo", "all").map((x) => x.id)).toEqual(["3"]);
  });
  it("filters by status", () => {
    expect(filterPages(pages, "", "draft").map((x) => x.id)).toEqual(["2"]);
    expect(filterPages(pages, "", "published")).toHaveLength(2);
  });
  it("sorts", () => {
    expect(sortPages(pages, "title-desc")[0].id).toBe("3");
    expect(sortPages(pages, "updated-desc")[0].id).toBe("3");
    expect(sortPages(pages, "updated-asc")[2].id).toBe("3");
  });
  it("calls the home page Home and every other page by its own name", () => {
    const home = p({ id: "h", name: "Ama's Kitchen", isRoot: true, path: "/" });
    expect(pageLabel(home)).toBe("Home");
    expect(pageLabel(pages[0])).toBe("About us");
    // people find it by either word
    expect(filterPages([home, ...pages], "home", "all").map((x) => x.id)).toEqual(["h"]);
    expect(filterPages([home, ...pages], "kitchen", "all").map((x) => x.id)).toEqual(["h"]);
    expect(sortPages([home, ...pages], "title-asc").map((x) => pageLabel(x))).toEqual(["About us", "Contact", "Home", "Zebra"]);
  });
  it("words times", () => {
    const now = Date.parse("2026-06-01T12:00:00Z");
    expect(relativeTime("2026-06-01T11:59:50Z", now)).toBe("Just now");
    expect(relativeTime("2026-06-01T11:30:00Z", now)).toBe("30 minutes ago");
    expect(relativeTime("2026-05-31T11:00:00Z", now)).toBe("Yesterday");
    expect(relativeTime(null, now)).toBe("—");
  });
  it("links into the right view", () => {
    expect(editViewHref("x", "RAW_UPLOAD", "code")).toBe("/dashboard/templates/x?mode=code");
    expect(editViewHref("x", "BUILDER", "design")).toBe("/dashboard/templates/x");
    expect(canEditAs("BUILDER", "code")).toBe(true); // a block page is turned into code first
    expect(canEditAs("REACT_PROJECT", "code")).toBe(false);
    expect(canEditAs("RAW_UPLOAD", "text")).toBe(true);
    expect(parseEditMode(["text"])).toBe("text");
    expect(parseEditMode("zzz")).toBeNull();
  });
  it("builds a live link", () => {
    expect(liveUrl("a.com", "/")).toBe("https://a.com");
    expect(liveUrl("a.com", "/x")).toBe("https://a.com/x");
    expect(liveUrl(null, "/x")).toBeNull();
  });
});
