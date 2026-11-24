import { describe, expect, it } from "vitest";
import { advancedHref, advancedKind, advancedSections, parseAdvancedSection, resolveAdvancedSection, seoGap, seoLengthHint } from "@/lib/dashboardV3/hubAdvanced";
import { hubTabs, NO_FEATURES } from "@/lib/dashboardV3/hubTabs";

const ids = (i: Parameters<typeof advancedSections>[0]) => advancedSections(i).map((s) => s.id);

describe("Advanced area: who sees it", () => {
  it("only pros get an Advanced tab, for every kind of site", () => {
    for (const f of [NO_FEATURES, { ...NO_FEATURES, app: true }, { ...NO_FEATURES, deployed: "server" as const }, { ...NO_FEATURES, store: true }]) {
      expect(hubTabs(f, "beginner").map((t) => t.id)).not.toContain("advanced");
      expect(hubTabs(f, "intermediate").map((t) => t.id)).not.toContain("advanced");
      expect(hubTabs(f, "pro").map((t) => t.id).at(-1)).toBe("advanced");
    }
  });
  it("beginners and intermediate people get no sections at all", () => {
    for (const experience of ["beginner", "intermediate"] as const) for (const kind of ["site", "app", "hosted"] as const) expect(advancedSections({ kind, experience })).toEqual([]);
  });
});

describe("Advanced area: sections per kind", () => {
  it("a website gets search, code, forms, old links, versions and the rest", () => {
    expect(ids({ kind: "site", experience: "pro" })).toEqual(["seo", "code", "features", "layout", "lists", "forms", "redirects", "scripts", "versions", "deploy", "copy", "danger"]);
  });
  it("variables on a website need a plan with servers", () => {
    expect(ids({ kind: "site", experience: "pro", ssrEnabled: false })).not.toContain("variables");
    expect(ids({ kind: "site", experience: "pro", ssrEnabled: true })).toContain("variables");
  });
  it("an app-builder app gets its own set and none of the website ones", () => {
    const got = ids({ kind: "app", experience: "pro" });
    expect(got).toEqual(["appsettings", "appseo", "appsignin", "appfiles", "appcode", "layout", "data", "functions", "secrets", "users", "history", "publish", "appgithub", "danger"]);
    for (const site of ["seo", "forms", "redirects", "lists"]) expect(got).not.toContain(site);
  });
  it("a hosted server app gets deploy, variables and GitHub; a static one only deploy", () => {
    expect(ids({ kind: "hosted", experience: "pro", server: true })).toEqual(["deploy", "layout", "variables", "github", "danger"]);
    expect(ids({ kind: "hosted", experience: "pro", server: false })).toEqual(["deploy", "layout", "danger"]);
  });
  it("every section has a plain label and a one-line help", () => {
    for (const kind of ["site", "app", "hosted"] as const) for (const s of advancedSections({ kind, experience: "pro", server: true, ssrEnabled: true })) {
      expect(s.label.length).toBeGreaterThan(2);
      expect(s.help.endsWith(".")).toBe(true);
      expect(s.help).not.toMatch(/\b(DNS|SQL|HTML|Postgres|SDK|subdomain|slug)\b/);
    }
  });
  it("picks the kind from the site's features", () => {
    expect(advancedKind(NO_FEATURES)).toBe("site");
    expect(advancedKind({ ...NO_FEATURES, app: true })).toBe("app");
    expect(advancedKind({ ...NO_FEATURES, deployed: "static" })).toBe("hosted");
  });
});

describe("Advanced area: addresses", () => {
  const sections = advancedSections({ kind: "site", experience: "pro" });
  it("falls back to the first section for an unknown or missing one", () => {
    expect(resolveAdvancedSection(undefined, sections)).toBe("seo");
    expect(resolveAdvancedSection("data", sections)).toBe("seo");
    expect(resolveAdvancedSection("forms", sections)).toBe("forms");
    expect(resolveAdvancedSection("forms", [])).toBeNull();
  });
  it("parses and builds hub addresses", () => {
    expect(parseAdvancedSection("seo")).toBe("seo");
    expect(parseAdvancedSection("nope")).toBeNull();
    expect(advancedHref("abc")).toBe("/dashboard/sites/abc?tab=advanced");
    expect(advancedHref("abc", "forms")).toBe("/dashboard/sites/abc?tab=advanced&section=forms");
  });
});

describe("search guidance", () => {
  it("says what a page is missing in plain words", () => {
    expect(seoGap({ title: "", description: "", image: "", isRaw: false })).toBe("Add a title and a short description.");
    expect(seoGap({ title: "Hi", description: "", image: "", isRaw: false })).toBe("Add a short description.");
    expect(seoGap({ title: "Hi", description: "Yes", image: "", isRaw: false })).toBe("");
    expect(seoGap({ title: "", description: "", image: "", isRaw: true })).toBe("");
  });
  it("warns, never blocks, on long text", () => {
    expect(seoLengthHint("title", "x".repeat(61))).toMatch(/cut this short/);
    expect(seoLengthHint("title", "x".repeat(60))).toBeNull();
    expect(seoLengthHint("description", "x".repeat(161))).toMatch(/cut this short/);
  });
});
