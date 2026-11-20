import { describe, expect, it } from "vitest";
import { buildSiteNotices, stripHeadline, planFor, type SiteNoticeStatus } from "@/lib/plan/siteNotices";

const base: SiteNoticeStatus = {
  plan: "FREE", previousPlan: null, trialAvailable: true, homeOnly: true, isApp: false,
  site: { id: "s", name: "Kharis", isLive: true, liveAddress: "kharis.plexo.site", pausedCustomDomains: [], everPublished: true },
  otherLiveSite: null, pageCount: 4, unpublishedPageCount: 0, archivedByPlanPageCount: 0,
  secondaryLinks: [{ href: "/about", label: "About" }, { href: "/contact", label: "Contact" }, { href: "/services", label: "Services" }],
};

describe("buildSiteNotices", () => {
  it("is silent on a paid plan", () => expect(buildSiteNotices({ ...base, homeOnly: false })).toEqual([]));
  it("orders links before the pages notice and never stacks into more than one strip line", () => {
    const n = buildSiteNotices(base);
    expect(n.map((x) => x.key)).toEqual(["links", "pages"]);
    expect(stripHeadline(n)).toBe("3 links on this page go to pages that aren't live yet · and 1 more");
  });
  it("uses singular wording for one link", () => {
    const n = buildSiteNotices({ ...base, pageCount: 1, secondaryLinks: [{ href: "/about", label: "About" }] });
    expect(stripHeadline(n)).toBe("1 link on this page goes to pages that aren't live yet");
  });
  it("puts an offline site first", () => {
    const n = buildSiteNotices({ ...base, site: { ...base.site!, isLive: false }, otherLiveSite: { id: "o", name: "Other" } });
    expect(n[0]).toMatchObject({ key: "offline", canMakeLive: true });
    expect(n[0].detail).toContain("Other is live now");
  });
  it("offers to reactivate the previous plan", () => {
    const n = buildSiteNotices({ ...base, previousPlan: "PRO", secondaryLinks: [] });
    expect(n[0].upgradeLabel).toBe("Reactivate Pro");
    expect(planFor({ previousPlan: "PRO" }, "STARTER")).toBe("PRO");
  });
  it("tells apps their first screen only", () => {
    const n = buildSiteNotices({ ...base, isApp: true, pageCount: 1, secondaryLinks: [] });
    expect(n.map((x) => x.key)).toEqual(["app"]);
  });
  it("has no empty headline", () => expect(stripHeadline([])).toBe(""));
});
