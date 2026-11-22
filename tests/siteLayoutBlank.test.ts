import { beforeEach, describe, expect, it, vi } from "vitest";

// A small in-memory stand-in for the content tables, so the migration, the looks and the "never two headers" rules run for real.
type Row = Record<string, any>;
const { db, tplApi, layoutApi } = vi.hoisted(() => {
  type R = Record<string, any>;
const db = { templates: new Map<string, R>(), layouts: new Map<string, R>(), saved: [] as string[], recompiled: [] as string[] };

const tplApi = {
  get: ({ id }: { id: string }) => ({ go: async () => ({ data: db.templates.get(id) ?? null }) }),
  create: (v: R) => ({ go: async () => void db.templates.set(v.id, { ...v }) }),
  patch: ({ id }: { id: string }) => ({
    set: (v: R) => ({
      go: async () => {
        db.templates.set(id, { ...db.templates.get(id), ...v });
        db.saved.push(id);
      },
    }),
  }),
  query: { byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: [...db.templates.values()].filter((t) => t.parentId === parentId) }) }) },
};
const layoutApi = {
  get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: db.layouts.get(templateId) ?? null }) }),
  create: (v: R) => ({ go: async () => void db.layouts.set(v.templateId, { ...v }) }),
  patch: ({ templateId }: { templateId: string }) => ({ set: (v: R) => ({ go: async () => void db.layouts.set(templateId, { ...db.layouts.get(templateId), ...v }) }) }),
};

  return { db, tplApi, layoutApi };
});

vi.mock("@/lib/db/contentEntities", () => ({ Template: tplApi, SiteLayout: layoutApi, BlogSite: {}, PublishedDomain: {} }));
vi.mock("@/lib/db/commerceEntities", () => ({ CommerceSettings: {} }));
vi.mock("@/lib/siteLayoutCore", async () => {
  const real = await vi.importActual<typeof import("@/lib/siteLayoutCore")>("@/lib/siteLayoutCore").catch(() => ({}) as Record<string, unknown>);
  return {
    ...real,
    onTemplateSaved: async (id: string) => void db.recompiled.push(id),
    compileTemplateWithSiteLayout: async () => "<html>recompiled</html>",
  };
});

import { adoptLook, designIsBlank, ensureBlankSiteLayout, fragmentIsBlank, lookSourceFor, pagesWithOwnChrome, removeOwnChrome, siteKindForLayout, unsupportedLayoutMessage } from "@/lib/siteLayoutBlank";
import { chromeFor } from "@/lib/v2/siteFormat";
import { buildV2Page } from "@/lib/v2/layoutDesigns";

const headerCmd = (links: { label: string; href: string }[]) => ({ op: "addSection", kind: "header", id: "sec-header", variant: "classic", content: { brand: "Acme Bakes", logo: "", links, cta: { label: "Order", href: "/order" } } });
const footerCmd = { op: "addSection", kind: "footer", id: "sec-footer", variant: "simple", content: { brand: "Acme Bakes", text: "", columns: [], socials: [], copyright: "© Acme" } };
const heroCmd = { op: "addSection", kind: "hero", id: "sec-hero" };

function site(id: string, over: Row = {}) {
  db.templates.set(id, { id, organizationId: "o", userId: "u", name: "Acme Bakes", kind: "LANDING_PAGE", sourceType: "BUILDER", parentId: null, designFormat: "v2", compiledHtml: "<html>old</html>", ...over });
}

beforeEach(() => {
  db.templates.clear();
  db.layouts.clear();
  db.saved = [];
  db.recompiled = [];
});

describe("which sites get a shared header and footer", () => {
  it("documents every kind", () => {
    expect(siteKindForLayout({ sourceType: "BUILDER", designFormat: "v2" })).toBe("visual");
    expect(siteKindForLayout({ sourceType: "BUILDER" })).toBe("classic");
    expect(siteKindForLayout({ sourceType: "RAW_UPLOAD" })).toBe("html");
    expect(siteKindForLayout({ sourceType: "REACT_PROJECT" })).toBe("app");
    expect(unsupportedLayoutMessage("visual")).toBeNull();
    expect(unsupportedLayoutMessage("classic")).toBeNull();
    expect(unsupportedLayoutMessage("html")).toMatch(/hand-written/);
    expect(unsupportedLayoutMessage("app")).toMatch(/built with code/);
    expect(`${unsupportedLayoutMessage("html")}${unsupportedLayoutMessage("app")}`).not.toMatch(/React|SQL|JSON|API|file path/i);
  });
});

describe("blank detection", () => {
  it("a header with no sections / no rows is blank; one with content is not", () => {
    expect(designIsBlank(null)).toBe(true);
    expect(designIsBlank({ designFormat: "v2", designJson: buildV2Page("H", "h", []) })).toBe(true);
    expect(designIsBlank({ designFormat: "v2", designJson: buildV2Page("H", "h", [headerCmd([{ label: "Home", href: "/" }])]) })).toBe(false);
    expect(designIsBlank({ designJson: { body: { rows: [] } } })).toBe(true);
    expect(designIsBlank({ designJson: { body: { rows: [{}] } } })).toBe(false);
    expect(designIsBlank({ designJson: {} })).toBe(true);
  });
});

describe("lazy migration of an older site", () => {
  it("gives a new-editor site blank header and footer, enabled, without touching any page", async () => {
    site("s1");
    expect(await ensureBlankSiteLayout("s1", "u")).toEqual({ status: "created", kind: "visual" });
    const layout = db.layouts.get("s1")!;
    expect(layout).toMatchObject({ enabled: true });
    expect(layout.layoutProvisionedAt).toBeTruthy();
    expect(await fragmentIsBlank(layout.headerTemplateId)).toBe(true);
    expect(await fragmentIsBlank(layout.footerTemplateId)).toBe(true);
    expect(db.templates.get(layout.headerTemplateId)).toMatchObject({ isSiteLayoutFragment: true, designFormat: "v2", name: "Site Header" });
    // Nothing about how a published page renders changed: no page was recompiled or saved.
    expect(db.recompiled).toEqual([]);
    expect(db.templates.get("s1")!.compiledHtml).toBe("<html>old</html>");
    expect(db.saved).toEqual([]);
  });
  it("gives a classic site blank classic fragments", async () => {
    site("c1", { designFormat: undefined });
    expect(await ensureBlankSiteLayout("c1", "u")).toMatchObject({ status: "created", kind: "classic" });
    const frag = db.templates.get(db.layouts.get("c1")!.headerTemplateId)!;
    expect(frag.designFormat).toBeUndefined();
    expect(frag.designJson.body.rows).toEqual([]);
  });
  it("leaves hand-written and code-app sites alone, and says so", async () => {
    site("r1", { sourceType: "RAW_UPLOAD" });
    site("a1", { sourceType: "REACT_PROJECT" });
    expect(await ensureBlankSiteLayout("r1", "u")).toEqual({ status: "unsupported", kind: "html" });
    expect(await ensureBlankSiteLayout("a1", "u")).toEqual({ status: "unsupported", kind: "app" });
    expect(db.layouts.size).toBe(0);
  });
  it("ignores pages inside a site and unknown ids", async () => {
    site("s1");
    site("p1", { parentId: "s1", slug: "about" });
    expect((await ensureBlankSiteLayout("p1", "u")).status).toBe("unsupported");
    expect((await ensureBlankSiteLayout("nope", "u")).status).toBe("unsupported");
    expect(db.layouts.size).toBe(0);
  });
  it("is idempotent", async () => {
    site("s1");
    await ensureBlankSiteLayout("s1", "u");
    const before = JSON.stringify([...db.layouts.entries()]);
    const templates = db.templates.size;
    expect((await ensureBlankSiteLayout("s1", "u")).status).toBe("exists");
    expect(JSON.stringify([...db.layouts.entries()])).toBe(before);
    expect(db.templates.size).toBe(templates);
  });
  it("never brings back a header the owner removed", async () => {
    site("s1");
    await ensureBlankSiteLayout("s1", "u");
    const l = db.layouts.get("s1")!;
    db.layouts.set("s1", { ...l, headerTemplateId: undefined, footerTemplateId: undefined });
    expect((await ensureBlankSiteLayout("s1", "u")).status).toBe("exists");
    expect(db.layouts.get("s1")!.headerTemplateId).toBeUndefined();
  });
  it("keeps the owner's saved header/footer code when a row already exists only for it", async () => {
    site("s1");
    db.layouts.set("s1", { templateId: "s1", organizationId: "o", enabled: false, customHeadCode: "<meta name=a content=b>" });
    expect((await ensureBlankSiteLayout("s1", "u")).status).toBe("created");
    expect(db.layouts.get("s1")).toMatchObject({ customHeadCode: "<meta name=a content=b>", enabled: true });
  });
  it("does not touch a site that already has its own header", async () => {
    site("s1");
    db.layouts.set("s1", { templateId: "s1", enabled: true, headerTemplateId: "h1" });
    expect((await ensureBlankSiteLayout("s1", "u")).status).toBe("exists");
    expect(db.templates.size).toBe(1);
  });
});

describe("a blank layout never makes a page show two headers", () => {
  it("pages still bring their own header while the shared one is blank, and stop once it is real", async () => {
    site("s1");
    await ensureBlankSiteLayout("s1", "u");
    expect(await chromeFor("s1", "Acme Bakes")).toMatchObject({ header: true, footer: true });
    // A site that never had a layout behaves the same.
    site("s2");
    expect(await chromeFor("s2", "x")).toMatchObject({ header: true, footer: true });
    db.templates.set("s1", { ...db.templates.get("s1")!, designJson: buildV2Page("Home", "home", [headerCmd([{ label: "Home", href: "/" }]), heroCmd]) });
    expect((await adoptLook("s1", "header", "classic", "u")).ok).toBe(true);
    expect(await chromeFor("s1", "Acme Bakes")).toMatchObject({ header: false, footer: true });
  });
});

describe("one-click looks drawn from the site's own menu", () => {
  const links = [{ label: "Home", href: "/" }, { label: "Menu", href: "/menu" }, { label: "Visit", href: "/visit" }];
  beforeEach(() => {
    site("s1", { designJson: buildV2Page("Home", "home", [headerCmd(links), heroCmd, footerCmd]) });
  });

  it("uses the home page's existing menu, brand and button", async () => {
    const src = await lookSourceFor("s1");
    expect(src).toMatchObject({ from: "menu", brand: "Acme Bakes", cta: { label: "Order", href: "/order" } });
    expect(src!.links).toEqual(links);
  });
  it("falls back to the site's pages when the home page has no menu", async () => {
    site("s9", { designJson: buildV2Page("Home", "home", [heroCmd]) });
    site("p1", { parentId: "s9", slug: "menu", name: "Menu", order: 1 });
    site("p2", { parentId: "s9", slug: "about", name: "About us", order: 0 });
    const src = await lookSourceFor("s9");
    expect(src!.from).toBe("pages");
    expect(src!.links).toEqual([{ label: "Home", href: "/" }, { label: "About us", href: "/about" }, { label: "Menu", href: "/menu" }]);
  });
  it("adopting a header fills the blank one and recompiles every page (the owner's opt-in)", async () => {
    await ensureBlankSiteLayout("s1", "u");
    const headerId = db.layouts.get("s1")!.headerTemplateId;
    const r = await adoptLook("s1", "header", "centered", "u");
    expect(r).toMatchObject({ ok: true, fragmentId: headerId });
    expect(await fragmentIsBlank(headerId)).toBe(false);
    expect(JSON.stringify(db.templates.get(headerId)!.designJson)).toContain("/visit");
    expect(JSON.stringify(db.templates.get(headerId)!.designJson)).toContain("centered");
    expect(db.recompiled).toContain(headerId);
    // The footer is still blank: adopting one part changes only that part.
    expect(await fragmentIsBlank(db.layouts.get("s1")!.footerTemplateId)).toBe(true);
  });
  it("offers to remove the old inline header, and only removes it once the shared one exists", async () => {
    await ensureBlankSiteLayout("s1", "u");
    await expect(removeOwnChrome("s1", "header")).rejects.toThrow(/Add your site header first/);
    expect(JSON.stringify(db.templates.get("s1")!.designJson)).toContain("sec-header");
    const r = await adoptLook("s1", "header", "classic", "u");
    expect(r.ok && r.pagesWithOwnChrome).toEqual([{ id: "s1", name: "Acme Bakes" }]);
    expect(await removeOwnChrome("s1", "header")).toBe(1);
    expect(await pagesWithOwnChrome("s1", "header")).toEqual([]);
    expect(JSON.stringify(db.templates.get("s1")!.designJson)).not.toContain("sec-header");
    expect(JSON.stringify(db.templates.get("s1")!.designJson)).toContain("sec-hero"); // the page's own content stays
    expect(JSON.stringify(db.templates.get("s1")!.designJson)).toContain("sec-footer"); // only the header was removed
  });
  it("kindly refuses classic, hand-written and app sites, and unknown looks", async () => {
    site("c1", { designFormat: undefined });
    site("r1", { sourceType: "RAW_UPLOAD" });
    site("a1", { sourceType: "REACT_PROJECT" });
    for (const id of ["c1", "r1", "a1"]) {
      const r = await adoptLook(id, "header", "classic", "u");
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).not.toMatch(/undefined|Error|exception/);
    }
    const bad = await adoptLook("s1", "header", "does-not-exist", "u");
    expect(bad).toEqual({ ok: false, error: "Pick one of the looks shown." });
  });
});
