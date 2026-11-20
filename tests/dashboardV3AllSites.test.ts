import { describe, expect, it } from "vitest";
import { cardActions, onColour, siteColour, summaryLine } from "@/lib/dashboardV3/allSites";
import { deleteSiteCopy } from "@/lib/dashboardV3/deleteSite";

const hrefs = { edit: "/e", preview: "/p", live: "https://a.test", product: "/prod", orders: "/ord", post: "/post", lessons: "/less" };
const ids = (kind: string, status: string, address: string | null, live: string | null = hrefs.live) => cardActions({ id: "1", kind, status, address }, { ...hrefs, live }).map((a) => a.id);

describe("all my sites cards", () => {
  it("edit always comes first, and an online site can be viewed and shared", () => {
    expect(ids("Website", "live", "a.test")).toEqual(["edit", "view", "share"]);
  });
  it("a site that is not online offers a preview and no share (nothing to share yet)", () => {
    const a = cardActions({ id: "1", kind: "Website", status: "draft", address: null }, { ...hrefs, live: null });
    expect(a.map((x) => x.id)).toEqual(["edit", "view"]);
    expect(a[1]).toMatchObject({ label: "Preview", href: "/p" });
  });
  it("a store adds products and orders; a blog and a course get their own next step", () => {
    expect(ids("Online store", "live", "s.test")).toEqual(["edit", "view", "share", "product", "orders"]);
    expect(ids("Blog", "live", "b.test")).toContain("post");
    expect(ids("Course", "live", "c.test")).toContain("lessons");
    expect(ids("Website", "live", "w.test")).not.toContain("product");
  });
  it("every action that is not Share goes somewhere", () => {
    for (const a of cardActions({ id: "1", kind: "Online store", status: "live", address: "s.test" }, hrefs)) if (a.id !== "share") expect(a.href).toBeTruthy();
  });
  it("gives each site a steady colour, using its brand when it has one", () => {
    expect(siteColour("Ama's Kitchen", "#112233")).toBe("#112233");
    expect(siteColour("Ama's Kitchen")).toBe(siteColour("Ama's Kitchen"));
    expect(siteColour("x", "not a colour")).toMatch(/^#[0-9A-F]{6}$/);
    expect(onColour("#ffffff")).toBe("#111111");
    expect(onColour("#112233")).toBe("#ffffff");
  });
  it("says it in a sentence", () => {
    expect(summaryLine(0, 0)).toBe("You have no sites yet.");
    expect(summaryLine(1, 1)).toBe("You have 1 site and it is online.");
    expect(summaryLine(3, 3)).toBe("You have 3 sites and every one is online.");
    expect(summaryLine(4, 1)).toBe("You have 4 sites. 1 is online.");
    expect(summaryLine(4, 0)).toBe("You have 4 sites. None are online yet.");
  });
});

describe("the delete-site confirmation", () => {
  it("names the site and says what happens, in plain words", () => {
    const c = deleteSiteCopy({ name: "Ama's Kitchen", live: false });
    expect(c.title).toBe('Delete "Ama\'s Kitchen"?');
    expect(c.goes.join(" ")).toContain("can't be undone");
    expect(c.stays.join(" ")).toContain("other websites");
    expect(c.needsTick).toBe(false);
  });
  it("a live site says its address stops working and asks for a tick first", () => {
    const c = deleteSiteCopy({ name: "Ama", live: true, address: "ama.plexopages.com" });
    expect(c.goes.join(" ")).toContain("ama.plexopages.com stops working");
    expect(c.needsTick).toBe(true);
  });
  it("a store mentions products and orders", () => {
    expect(deleteSiteCopy({ name: "S", live: false, kind: "Online store" }).goes[0]).toContain("products and orders");
  });
});
