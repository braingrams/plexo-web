import { describe, expect, it } from "vitest";
import { brandStepDone, displayBrand, lookOutcomeMessage, lookTokens, normalizeHex, readSiteBrand, sanitizeBrandLook, siteBrandFromLook, siteBrandFromProfile } from "@/lib/dashboardV3/brandLook";
import { taskLink } from "@/lib/dashboardV3/taskLinks";
import { summarizeSites } from "@/lib/dashboardV3/siteList";
import { computeTasks, EMPTY_FACTS, type SiteFacts } from "@/lib/dashboardV3/tasks";

describe("normalizeHex", () => {
  it("accepts 3 and 6 digit codes with or without #", () => {
    expect(normalizeHex("#e4572e")).toBe("#E4572E");
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex(" 1F6FEB ")).toBe("#1F6FEB");
  });
  it("rejects anything else", () => {
    for (const bad of ["", "tomato", "#12", "#GGGGGG", "#1234567", 5, null]) expect(normalizeHex(bad)).toBeNull();
  });
});

describe("sanitizeBrandLook", () => {
  it("needs a main colour", () => {
    expect(sanitizeBrandLook({ colors: [] })).toEqual({ ok: false, error: "Choose a main colour first." });
    expect(sanitizeBrandLook(null).ok).toBe(false);
  });
  it("normalises colours, drops duplicates, explains bad ones", () => {
    expect(sanitizeBrandLook({ colors: ["#e4572e", "E4572E", "1f6feb"] })).toEqual({ ok: true, value: { colors: ["#E4572E", "#1F6FEB"], logoUrl: null, logoSkipped: false } });
    const bad = sanitizeBrandLook({ colors: ["red"] });
    expect(bad.ok).toBe(false);
  });
  it("keeps an https logo and ignores 'skipped' when there is one", () => {
    const r = sanitizeBrandLook({ colors: ["#E4572E"], logoUrl: "https://cdn.example.com/a.png", logoSkipped: true });
    expect(r).toEqual({ ok: true, value: { colors: ["#E4572E"], logoUrl: "https://cdn.example.com/a.png", logoSkipped: false } });
    expect(sanitizeBrandLook({ colors: ["#E4572E"], logoUrl: "http://x/a.png" }).ok).toBe(false);
  });
  it("records 'I don't have a logo'", () => {
    expect(sanitizeBrandLook({ colors: ["#E4572E"], logoSkipped: true })).toEqual({ ok: true, value: { colors: ["#E4572E"], logoUrl: null, logoSkipped: true } });
  });
});

describe("a site's own brand", () => {
  it("is read defensively from storage", () => {
    expect(readSiteBrand(undefined)).toBeUndefined();
    expect(readSiteBrand({ colors: ["nope"], logoUrl: "javascript:x" })).toBeUndefined();
    expect(readSiteBrand({ colors: ["#e4572e"], noLogo: true })).toEqual({ colors: ["#E4572E"], noLogo: true });
  });
  it("stores the look, a logo winning over 'skipped'", () => {
    expect(siteBrandFromLook({ colors: ["#E4572E"], logoUrl: null, logoSkipped: true })).toEqual({ colors: ["#E4572E"], noLogo: true });
    expect(siteBrandFromLook({ colors: ["#E4572E"], logoUrl: "https://c/a.png", logoSkipped: false })).toEqual({ colors: ["#E4572E"], logoUrl: "https://c/a.png" });
  });
  it("copies onboarding answers onto a new site, colours without a logo counting as a skipped logo", () => {
    expect(siteBrandFromProfile({ colors: ["#1F6FEB"] })).toEqual({ colors: ["#1F6FEB"], noLogo: true });
    expect(siteBrandFromProfile({ colors: ["#1F6FEB"], logoUrl: "https://c/a.png" })).toEqual({ colors: ["#1F6FEB"], logoUrl: "https://c/a.png" });
    expect(siteBrandFromProfile({ name: "Ama" })).toBeUndefined();
  });
  it("shows the account default only when the site has none of its own", () => {
    const profile = { colors: ["#1F6FEB"], logoUrl: "https://c/default.png" };
    expect(displayBrand(undefined, profile)).toEqual({ colors: ["#1F6FEB"], logoUrl: "https://c/default.png" });
    expect(displayBrand({ colors: ["#E4572E"], noLogo: true }, profile)).toEqual({ colors: ["#E4572E"], logoUrl: undefined, noLogo: true });
  });
  it("the step is done only from the site's own colours plus a logo or a skip", () => {
    expect(brandStepDone(undefined)).toBe(false);
    expect(brandStepDone({ colors: ["#E4572E"] })).toBe(false);
    expect(brandStepDone({ logoUrl: "https://c/a.png" })).toBe(false);
    expect(brandStepDone({ colors: ["#E4572E"], noLogo: true })).toBe(true);
    expect(brandStepDone({ colors: ["#E4572E"], logoUrl: "https://c/a.png" })).toBe(true);
  });
  it("lookTokens gives the editor's main and second colour", () => {
    expect(lookTokens(["#E4572E"])).toEqual({ primaryColor: "#E4572E" });
    expect(lookTokens(["#E4572E", "#1F6FEB"])).toEqual({ primaryColor: "#E4572E", secondaryColor: "#1F6FEB" });
  });
});

describe("two sites keep their own brand and their own step", () => {
  const rows = [
    { id: "a", name: "A", kind: "LANDING_PAGE", updatedAt: "2", brand: { colors: ["#E4572E"], logoUrl: "https://c/a.png" } },
    { id: "b", name: "B", kind: "LANDING_PAGE", updatedAt: "1", brand: { colors: ["#1F6FEB"], noLogo: true } },
    { id: "c", name: "C", kind: "LANDING_PAGE", updatedAt: "0" },
  ];
  const sites = summarizeSites(rows, []);
  const stepFor = (id: string) => {
    const own = sites.find((s) => s.id === id)?.brand;
    const facts: SiteFacts = { ...EMPTY_FACTS, hasSite: true, hasLogo: !!own?.logoUrl, logoSkipped: own?.noLogo === true, hasColors: !!own?.colors?.length };
    return computeTasks("business", facts).tasks.find((t) => t.id === "brand")!.state;
  };
  it("each site shows its own colours and logo", () => {
    expect(sites.map((s) => [s.id, s.brand?.colors?.[0], s.brand?.logoUrl])).toEqual([["a", "#E4572E", "https://c/a.png"], ["b", "#1F6FEB", undefined], ["c", undefined, undefined]]);
  });
  it("one site's tick never leaks to another", () => {
    expect(stepFor("a")).toBe("done");
    expect(stepFor("b")).toBe("done");
    expect(stepFor("c")).toBe("current");
  });
});

describe("the brand step ticks with colours and a skipped logo", () => {
  it("needs colours as well", () => {
    const f = (o: Partial<SiteFacts>) => computeTasks("business", { ...EMPTY_FACTS, hasSite: true, ...o }).tasks[1].state;
    expect(f({ logoSkipped: true })).toBe("current");
    expect(f({ logoSkipped: true, hasColors: true })).toBe("done");
    expect(f({ hasLogo: true, hasColors: true })).toBe("done");
  });
});

describe("lookOutcomeMessage", () => {
  it("never pretends when nothing could be applied", () => {
    const m = lookOutcomeMessage({ updated: 0, needsPublish: 0, skipped: 2, logoPlaced: false }, true);
    expect(m.askSol).toBe(true);
    expect(m.text).toMatch(/^Saved\. This site can't be restyled automatically/);
  });
  it("says what happened when applied, and when publishing is still needed", () => {
    expect(lookOutcomeMessage({ updated: 3, needsPublish: 0, skipped: 0, logoPlaced: true }, true)).toEqual({ text: "Saved and applied to your pages. It's on your site now. Your logo is in the header.", askSol: false });
    expect(lookOutcomeMessage({ updated: 3, needsPublish: 1, skipped: 1, logoPlaced: false }, true).text).toMatch(/Publish your site.*no place for it.*One page was built another way/);
  });
});

describe("taskLink", () => {
  it("sends each step to the place it's done, with a button that says what it does", () => {
    expect(taskLink("brand", "s1", "Ama")).toMatchObject({ href: "/dashboard/sites/s1?tab=brand", label: "Add logo and colours" });
    for (const id of ["words", "contact", "links"] as const) expect(taskLink(id, "s1", "Ama")?.href).toBe(`/dashboard/sites/s1/words?for=${id}`);
    expect(taskLink("words", "s1", "Ama")?.label).toBe("Change the words");
    expect(taskLink("post", "s1", "Ama")).toMatchObject({ href: "/dashboard/sites/s1?tab=blog", label: "Write a post" });
    expect(taskLink("lesson", "s1", "Ama")?.href).toBe("/dashboard/sites/s1?tab=course");
    expect(taskLink("price", "s1", "Ama")?.href).toBe("/dashboard/sites/s1?tab=course");
    expect(taskLink("signin", "s1", "Ama")?.href).toBe("/dashboard/sites/s1?tab=app");
  });
  it("describing an app goes to SOL; steps done on Home have no link", () => {
    const d = taskLink("describe", "s1", "Ama");
    expect(d?.href).toBe(d?.solHref);
    expect(d?.href).toMatch(/^\/dashboard\/sol\?new=1&draft=/);
    expect(taskLink("finish", "s1", "Ama")).toBeNull();
    expect(taskLink("product", "s1", "Ama")).toBeNull();
  });
  it("gives every link step a task-specific SOL prompt", () => {
    expect(decodeURIComponent(taskLink("post", "s1", "Ama's Blog")!.solHref)).toContain("Ama's Blog");
  });
});
