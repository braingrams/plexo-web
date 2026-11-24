import { describe, expect, it } from "vitest";
import { endOfLocalDay, groupRestoreDays, localDay, planSiteRestore } from "@/lib/siteRestorePoints";

const revs = [
  { pageId: "home", pageName: "Home", id: "h1", createdAt: "2026-11-10T09:00:00.000Z" },
  { pageId: "home", pageName: "Home", id: "h2", createdAt: "2026-11-12T23:30:00.000Z" },
  { pageId: "home", pageName: "Home", id: "h3", createdAt: "2026-11-15T08:00:00.000Z" },
  { pageId: "about", pageName: "About", id: "a1", createdAt: "2026-11-12T10:00:00.000Z" },
];
const pages = [{ id: "home", name: "Home" }, { id: "about", name: "About" }, { id: "new", name: "Pricing" }];

describe("site restore points", () => {
  it("groups publishes by the owner's own day, newest first", () => {
    expect(groupRestoreDays(revs, 0).map((d) => [d.day, d.publishes, d.pages])).toEqual([["2026-11-15", 1, 1], ["2026-11-12", 2, 2], ["2026-11-10", 1, 1]]);
    // Lagos (UTC+1 → offset -60): 23:30Z on the 12th is already the 13th.
    expect(groupRestoreDays(revs, -60).map((d) => d.day)).toContain("2026-11-13");
    expect(localDay("2026-11-12T23:30:00.000Z", -60)).toBe("2026-11-13");
  });
  it("ends a day at the owner's midnight, not UTC's", () => {
    expect(endOfLocalDay("2026-11-12", -60)).toBe("2026-11-12T22:59:59.999Z");
    expect(endOfLocalDay("2026-11-12", 300)).toBe("2026-11-13T04:59:59.999Z");
  });
  it("puts each page back to its newest version of that day and leaves later pages alone", () => {
    const plan = planSiteRestore(revs, pages, endOfLocalDay("2026-11-12", 0), new Map([["home", "h3"], ["about", "a1"]]));
    expect(plan.restore).toEqual([{ pageId: "home", pageName: "Home", revisionId: "h2" }]);
    expect(plan.untouched).toEqual(["Pricing"]);
  });
});
