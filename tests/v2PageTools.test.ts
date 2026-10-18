import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Phase 4: the V2 page tools (page_describe / page_edit / page_create_from_template /
// page_publish / blog_layout_*), the deprecation of the classic and raw-HTML tools, and the
// flag-on delegation of the old create/publish tools to V2. In-memory stand-ins for the entities.

const h = vi.hoisted(() => ({
  templates: new Map<string, Record<string, any>>(),
  revisions: [] as Record<string, any>[],
  blogSites: new Map<string, Record<string, any>>(),
  domains: [] as Record<string, any>[],
  linked: [] as any[],
}));

vi.mock("@/server/authDynamo", () => ({ auth: vi.fn(), dynamoAdapter: {} }));
vi.mock("@/lib/db/client", () => ({
  TABLES: { content: "content", commerce: "commerce", ops: "ops", import: "import" },
  // publishTemplateDraft sends one transaction (revision + template patch): apply the patch.
  docClient: {
    send: vi.fn(async (cmd: any) => {
      for (const item of cmd?.input?.TransactItems ?? []) {
        const u = item.Update;
        const row = u && h.templates.get(u.id);
        if (row) { Object.assign(row, u.set); for (const k of u.removed) delete row[k]; }
      }
      return {};
    }),
  },
}));
vi.mock("@aws-sdk/lib-dynamodb", async (orig) => ({ ...(await orig<object>()), TransactWriteCommand: class { constructor(public input: unknown) {} } }));

const patchable = (id: string) => {
  const set: Record<string, any> = {};
  const removed: string[] = [];
  const b: any = {
    set(v: Record<string, any>) { Object.assign(set, v); return b; },
    remove(keys: string[]) { removed.push(...keys); return b; },
    params: () => ({ id, set, removed }),
    go: async () => {
      const row = h.templates.get(id);
      if (row) { Object.assign(row, set); for (const k of removed) delete row[k]; }
      return { data: row };
    },
  };
  return b;
};
vi.mock("@/lib/db/contentEntities", async (orig) => ({
  ...(await orig<object>()),
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.templates.get(id) ?? null }) }),
    patch: ({ id }: { id: string }) => patchable(id),
    create: (row: Record<string, any>) => ({ go: async () => { h.templates.set(row.id, { designFormat: "v1", sourceType: "BUILDER", ...row }); return { data: row }; } }),
    query: {
      byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.parentId === parentId) }) }),
      byOrg: ({ organizationId }: { organizationId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.organizationId === organizationId) }) }),
    },
    scan: { where: () => ({ go: async () => ({ data: [] }) }) },
  },
  TemplateRevision: {
    create: (row: Record<string, any>) => ({ params: () => { h.revisions.push(row); return row; }, go: async () => { h.revisions.push(row); return { data: row }; } }),
    query: { primary: () => ({ go: async () => ({ data: [...h.revisions].reverse() }) }) },
    remove: () => ({ go: async () => ({}) }),
  },
  SiteLayout: { get: () => ({ go: async () => ({ data: null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
  BlogSite: {
    get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.blogSites.get(templateId) ?? null }) }),
    create: (row: Record<string, any>) => ({ go: async () => { h.blogSites.set(row.templateId, row); return { data: row }; } }),
    patch: ({ templateId }: { templateId: string }) => ({ set: (v: any) => ({ go: async () => { Object.assign(h.blogSites.get(templateId) ?? {}, v); return {}; } }) }),
    scan: { where: () => ({ go: async () => ({ data: [] }) }) },
  },
  PublishedDomain: { query: { primary: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.domains.filter((d) => d.templateId === templateId) }) }) } },
}));
vi.mock("@/lib/db/commerceEntities", async (orig) => ({
  ...(await orig<object>()),
  CommerceSettings: { get: () => ({ go: async () => ({ data: null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/db/coreEntities", async (orig) => ({
  ...(await orig<object>()),
  User: { get: () => ({ go: async () => ({ data: { id: "u1", name: "Owner", aupAcceptedAt: "2026-01-01" } }) }), patch: () => ({ set: () => ({ go: async () => ({}) }) }) },
}));
vi.mock("@/lib/sites/linkDomain", async (orig) => ({
  ...(await orig<object>()),
  linkDomainToTemplate: vi.fn(async (_r: unknown, templateId: string, domain: string) => {
    h.linked.push({ templateId, domain });
    const finalDomain = domain.includes(".") ? domain : `${domain}.pages.test`;
    h.domains.push({ templateId, domain: finalDomain });
    return { finalDomain, publishedUrl: `https://${finalDomain}`, routingEndpoint: undefined, certificateValidationName: undefined, certificateValidationValue: undefined };
  }),
}));
vi.mock("@/lib/plan/sitesStore", async (orig) => ({ ...(await orig<object>()), setPagePublishFlags: vi.fn(async () => {}) }));

import { dispatchMcpTool, PLEXO_MCP_TOOLS } from "@/lib/mcp/dispatchMcpTool";
import { DEPRECATED_TOOLS, DEPRECATED_PREFIX } from "@/lib/mcp/deprecation";

const ULTRA = { userId: "u1", organizationId: "o1", subscriptionPlan: "ULTRA", customDomainLimit: null, role: null } as any;
const FREE = { ...ULTRA, subscriptionPlan: "FREE" } as any;
const call = (tool: string, args: any, who = ULTRA) => dispatchMcpTool(tool, args, who);

const v1Design = (text: string) => ({
  body: { style: { background: "#ffffff" }, rows: [{ id: `r-${text}`, style: {}, columns: [{ id: `c-${text}`, width: "100%", elements: [{ id: `e-${text}`, type: "heading", style: {}, attributes: { text } }] }] }] },
});
const seedClassic = (id: string, extra: Record<string, any> = {}) =>
  h.templates.set(id, { id, userId: "u1", organizationId: "o1", name: "Classic", kind: "LANDING_PAGE", designFormat: "v1", sourceType: "BUILDER", designJson: v1Design("OLD"), compiledHtml: "<p>OLD</p>", ...extra });

beforeEach(() => {
  h.templates.clear();
  h.revisions.length = 0;
  h.blogSites.clear();
  h.domains.length = 0;
  h.linked.length = 0;
  delete process.env.TEMPLATES_V2_NEW;
});
afterEach(() => {
  delete process.env.TEMPLATES_V2_NEW;
});

const heroOf = async (templateId: string) => {
  const d = await call("page_describe", { templateId, includeCatalog: false });
  return d.page.sections.find((s: any) => s.kind === "hero");
};

describe("page_create_from_template", () => {
  it("creates a complete, unpublished V2 site from a page template", async () => {
    const r = await call("page_create_from_template", { name: "Kalycare", templateId: "home" });
    expect(r).toMatchObject({ success: true, designFormat: "v2", publishedUrl: null, route: "/" });
    expect(r.sections.map((s: any) => s.kind)).toEqual(expect.arrayContaining(["header", "hero", "footer"]));
    const row = h.templates.get(r.templateId)!;
    expect(row.designFormat).toBe("v2");
    expect(row.designJson.format).toBe("plexo-v2@1");
    expect(row.compiledHtml).toContain("<html");
    expect(r.next).toContain("page_publish");
  });

  it("applies content commands in the same call, with per-command results (partial success)", async () => {
    const r = await call("page_create_from_template", {
      name: "Kalycare",
      templateId: "landing",
      content: [
        { op: "setBrand", tokens: { primaryColor: "#0F766E" } },
        { op: "updateSection", sectionId: "does-not-exist", content: { headline: "x" } },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.results.map((x: any) => x.ok)).toEqual([true, false]);
    expect(r.results[1].message).toMatch(/couldn't find/i);
    expect(h.templates.get(r.templateId)!.designJson.designSystem).toBeTruthy();
  });

  it("names the real choices when the template doesn't exist", async () => {
    await expect(call("page_create_from_template", { name: "X", templateId: "fancy" })).rejects.toThrow(/blank, home, landing, about, services, contact, pricing/);
  });

  it("adds a page to a V2 site (Ultra) with a unique slug and order", async () => {
    const home = await call("page_create_from_template", { name: "Home", templateId: "home" });
    const a = await call("page_create_from_template", { name: "About us", templateId: "about", siteId: home.templateId });
    const b = await call("page_create_from_template", { name: "About us", templateId: "about", siteId: home.templateId });
    expect(a).toMatchObject({ slug: "about-us", route: "/about-us", siteId: home.templateId });
    expect(b.slug).toBe("about-us-2");
    expect(h.templates.get(b.templateId)).toMatchObject({ parentId: home.templateId, order: 1, designFormat: "v2" });
  });

  it("Free plan: a plain-English limit message, nothing created", async () => {
    const home = await call("page_create_from_template", { name: "Home" }, FREE);
    await expect(call("page_create_from_template", { name: "About", siteId: home.templateId }, FREE)).rejects.toThrow(/Ultra plan/);
    for (let i = 0; i < 4; i++) await call("page_create_from_template", { name: `S${i}` }, FREE);
    const before = h.templates.size;
    await expect(call("page_create_from_template", { name: "One too many" }, FREE)).rejects.toThrow(/limit of 5 sites/);
    expect(h.templates.size).toBe(before);
  });

  it("won't mix a V2 page into a classic site", async () => {
    seedClassic("classic-root");
    await expect(call("page_create_from_template", { name: "About", siteId: "classic-root" })).rejects.toThrow(/classic editor/);
  });
});

describe("page_describe", () => {
  it("shows the site's pages, sections, brand and the catalog (incl. blog/store/funnel and page templates)", async () => {
    const home = await call("page_create_from_template", { name: "Home", templateId: "home" });
    await call("page_create_from_template", { name: "Pricing", templateId: "pricing", siteId: home.templateId });
    const d = await call("page_describe", { siteId: home.templateId });
    expect(d.site.pages.map((p: any) => [p.slug, p.route, p.designFormat])).toEqual([[null, "/", "v2"], ["pricing", "/pricing", "v2"]]);
    expect(d.page.sections.length).toBeGreaterThan(3);
    expect(d.page.hasUnpublishedChanges).toBe(false);
    expect(d.brand).toBeTruthy();
    const kinds = d.catalog.kinds.map((k: any) => k.kind);
    expect(kinds).toEqual(expect.arrayContaining(["hero", "blogList", "blogArticle", "shop", "cartCheckout", "funnelSignup"]));
    expect(d.catalog.pageTemplates.map((t: any) => t.id)).toEqual(["blank", "home", "landing", "about", "services", "contact", "pricing"]);
    const sub = await call("page_describe", { siteId: home.templateId, slug: "/pricing", includeCatalog: false });
    expect(sub.page.name).toBe("Pricing");
    expect(sub.catalog).toBeUndefined();
  });

  it("explains classic and raw pages instead of failing, and refuses other accounts' pages plainly", async () => {
    seedClassic("c1");
    seedClassic("raw1", { sourceType: "RAW_UPLOAD" });
    expect((await call("page_describe", { templateId: "c1" })).page.note).toMatch(/classic editor/);
    expect((await call("page_describe", { templateId: "raw1" })).page.note).toMatch(/hand-written HTML/);
    seedClassic("other", { organizationId: "someone-else" });
    await expect(call("page_describe", { templateId: "other" })).rejects.toThrow(/can't find a page/);
    await expect(call("page_describe", { templateId: "nope" })).rejects.toThrow(/list_landing_pages/);
  });

  it("reads the working copy when there is one", async () => {
    const r = await call("page_create_from_template", { name: "Home", templateId: "blank" });
    expect((await call("page_describe", { templateId: r.templateId, includeCatalog: false })).page.sections).toHaveLength(0);
    await call("page_edit", { templateId: r.templateId, commands: [{ op: "addSection", kind: "faq" }] });
    const d = await call("page_describe", { templateId: r.templateId, includeCatalog: false });
    expect(d.page.sections.map((s: any) => s.kind)).toEqual(["faq"]);
    expect(d.page.hasUnpublishedChanges).toBe(true);
  });
});

describe("page_edit", () => {
  it("saves to the working copy (like the editor's autosave), not live, and says so", async () => {
    const r = await call("page_create_from_template", { name: "Home", templateId: "home" });
    const liveBefore = h.templates.get(r.templateId)!.compiledHtml;
    const hero = await heroOf(r.templateId);
    const e = await call("page_edit", { templateId: r.templateId, commands: [{ op: "updateSection", sectionId: hero.id, content: { headline: "Bread, baked before sunrise" } }] });
    expect(e).toMatchObject({ ok: true, saved: true, hasUnpublishedChanges: true });
    const row = h.templates.get(r.templateId)!;
    expect(row.draftHtml).toContain("Bread, baked before sunrise");
    expect(row.compiledHtml).toBe(liveBefore);
    expect(e.next).toContain("page_publish");
    expect(e.results[0]).toMatchObject({ n: 1, ok: true });
    expect(e.results[0].change).toMatch(/Change/);
  });

  it("partial success: good commands are saved, bad ones explained", async () => {
    const r = await call("page_create_from_template", { name: "Home", templateId: "home" });
    const hero = await heroOf(r.templateId);
    const e = await call("page_edit", {
      templateId: r.templateId,
      commands: [
        { op: "updateSection", sectionId: hero.id, content: { headline: "Fresh" } },
        { op: "removeSection", sectionId: "ghost" },
        { op: "addSection", kind: "faq" },
      ],
    });
    expect(e.ok).toBe(true);
    expect(e.partial).toBe(true);
    expect(e.results.map((x: any) => x.ok)).toEqual([true, false, true]);
    expect(e.results[1].message).toMatch(/couldn't find/i);
    expect(e.next).toMatch(/2 change\(s\) saved, 1 couldn't be applied/);
  });

  it("nothing saved when every command fails", async () => {
    const r = await call("page_create_from_template", { name: "Home" });
    const e = await call("page_edit", { templateId: r.templateId, commands: [{ op: "removeSection", sectionId: "ghost" }] });
    expect(e).toMatchObject({ ok: false, saved: false });
    expect(h.templates.get(r.templateId)!.draftJson).toBeUndefined();
  });

  it("declines addPage with the right tool, and renamePage keeps the page's name in step", async () => {
    const r = await call("page_create_from_template", { name: "Home" });
    const e = await call("page_edit", { templateId: r.templateId, commands: [{ op: "addPage", name: "About" }, { op: "renamePage", name: "Welcome" }] });
    expect(e.results[0].ok).toBe(false);
    expect(e.results[0].message).toContain("page_create_from_template");
    expect(e.results[1].ok).toBe(true);
    expect(h.templates.get(r.templateId)!.name).toBe("Welcome");
  });

  it("plain errors for empty/too many commands and for classic/raw/email targets", async () => {
    const r = await call("page_create_from_template", { name: "Home" });
    await expect(call("page_edit", { templateId: r.templateId, commands: [] })).rejects.toThrow(/at least one change/);
    await expect(call("page_edit", { templateId: r.templateId, commands: Array.from({ length: 41 }, () => ({ op: "removeSection", sectionId: "x" })) })).rejects.toThrow(/at most 40/);
    seedClassic("c1");
    seedClassic("raw1", { sourceType: "RAW_UPLOAD" });
    seedClassic("em", { kind: "EMAIL" });
    await expect(call("page_edit", { templateId: "c1", commands: [{ op: "addSection", kind: "faq" }] })).rejects.toThrow(/update_template/);
    await expect(call("page_edit", { templateId: "raw1", commands: [{ op: "addSection", kind: "faq" }] })).rejects.toThrow(/hand-written HTML/);
    await expect(call("page_edit", { templateId: "em", commands: [{ op: "addSection", kind: "faq" }] })).rejects.toThrow(/email/i);
  });

  it("a command with a made-up page reference still lands on this page", async () => {
    const r = await call("page_create_from_template", { name: "Home", templateId: "blank" });
    const e = await call("page_edit", { templateId: r.templateId, commands: [{ op: "addSection", pageId: "home-page", kind: "cta" }] });
    expect(e.saved).toBe(true);
    expect(e.sections.map((s: any) => s.kind)).toContain("cta");
  });
});

describe("page_publish", () => {
  it("puts the working copy live as a new version and connects the domain", async () => {
    const r = await call("page_create_from_template", { name: "Kalycare", templateId: "home" });
    const hero = await heroOf(r.templateId);
    await call("page_edit", { templateId: r.templateId, commands: [{ op: "updateSection", sectionId: hero.id, content: { headline: "Care that comes to you" } }] });
    const p = await call("page_publish", { templateId: r.templateId, domain: "kalycare" });
    expect(p).toMatchObject({ success: true, domain: "kalycare.pages.test", publishedUrl: "https://kalycare.pages.test" });
    const row = h.templates.get(r.templateId)!;
    expect(row.compiledHtml).toContain("Care that comes to you");
    expect(row.draftJson).toBeUndefined();
    expect(h.revisions).toHaveLength(1);
    expect(h.linked).toEqual([{ templateId: r.templateId, domain: "kalycare" }]);
  });

  it("with no address anywhere it still publishes and offers subdomain ideas", async () => {
    const r = await call("page_create_from_template", { name: "Kalycare Home Care" });
    const p = await call("page_publish", { templateId: r.templateId });
    expect(p.needsDomain).toBe(true);
    expect(p.suggestedDomains[0]).toBe("kalycare-home-care");
    expect(p.next).toMatch(/domain/);
  });

  it("a sub-page goes live at the site's address; Free can't publish it", async () => {
    const home = await call("page_create_from_template", { name: "Home" });
    await call("page_publish", { templateId: home.templateId, domain: "shop" });
    const about = await call("page_create_from_template", { name: "About", templateId: "about", siteId: home.templateId });
    const p = await call("page_publish", { templateId: about.templateId });
    expect(p.publishedUrl).toBe("https://shop.pages.test/about");
    await expect(call("page_publish", { templateId: about.templateId, domain: "x" })).rejects.toThrow(/whole site/);
    await expect(call("page_publish", { templateId: about.templateId }, FREE)).rejects.toThrow(/Free plan publishes one page per site/);
  });

  it("classic and raw pages are pointed to the right tool", async () => {
    seedClassic("c1");
    await expect(call("page_publish", { templateId: "c1", domain: "a" })).rejects.toThrow(/publish_existing_landing_page/);
  });

  it("publish_existing_landing_page on a V2 page also publishes its working copy", async () => {
    const r = await call("page_create_from_template", { name: "Home", templateId: "home" });
    const hero = await heroOf(r.templateId);
    await call("page_edit", { templateId: r.templateId, commands: [{ op: "updateSection", sectionId: hero.id, content: { headline: "Via the old tool" } }] });
    const p = await call("publish_existing_landing_page", { templateId: r.templateId, domain: "oldway" });
    expect(p.publishedUrl).toBe("https://oldway.pages.test");
    expect(h.templates.get(r.templateId)!.compiledHtml).toContain("Via the old tool");
  });
});

describe("blog layouts (V2)", () => {
  it("blog_layout_edit builds a visual layout, warns until it has the article, then is quiet", async () => {
    const site = await call("page_create_from_template", { name: "Blog site" });
    const none = await call("blog_layout_describe", { templateId: site.templateId, kind: "post" });
    expect(none.exists).toBe(false);
    const first = await call("blog_layout_edit", { templateId: site.templateId, kind: "post", commands: [{ op: "addSection", kind: "header" }] });
    expect(first.saved).toBe(true);
    expect(first.warning).toMatch(/blogArticle/);
    const layoutId = first.layoutTemplateId;
    expect(h.templates.get(layoutId)).toMatchObject({ designFormat: "v2", isBlogLayout: true });
    expect(h.blogSites.get(site.templateId)!.postLayoutTemplateId).toBe(layoutId);
    const second = await call("blog_layout_edit", { templateId: site.templateId, kind: "post", commands: [{ op: "addSection", kind: "blogArticle" }] });
    expect(second.warning).toBeUndefined();
    const d = await call("blog_layout_describe", { templateId: site.templateId, kind: "post", includeCatalog: false });
    expect(d).toMatchObject({ exists: true, designFormat: "v2", hasRequiredSection: true });
  });

  it("malformed commands leave no empty layout behind; design_blog_layout refuses a V2 layout", async () => {
    const site = await call("page_create_from_template", { name: "Blog site" });
    const bad = await call("blog_layout_edit", { templateId: site.templateId, kind: "listing", commands: [{ op: "removeSection", sectionId: "x" }] });
    expect(bad.saved).toBe(false);
    expect(h.blogSites.get(site.templateId)).toBeUndefined();
    await call("blog_layout_edit", { templateId: site.templateId, kind: "post", commands: [{ op: "addSection", kind: "blogArticle" }] });
    await expect(call("design_blog_layout", { templateId: site.templateId, kind: "post", designJson: v1Design("x") })).rejects.toThrow(/blog_layout_edit/);
  });

  it("a classic layout with content is never silently replaced", async () => {
    const site = await call("page_create_from_template", { name: "Blog site" });
    seedClassic("lay", { isBlogLayout: true });
    h.blogSites.set(site.templateId, { templateId: site.templateId, postLayoutTemplateId: "lay" });
    await expect(call("blog_layout_edit", { templateId: site.templateId, kind: "post", commands: [{ op: "addSection", kind: "blogArticle" }] })).rejects.toThrow(/startFresh/);
    const ok = await call("blog_layout_edit", { templateId: site.templateId, kind: "post", startFresh: true, commands: [{ op: "addSection", kind: "blogArticle" }] });
    expect(ok.saved).toBe(true);
    expect(h.templates.get("lay")!.designFormat).toBe("v2");
  });
});

describe("classic and raw-HTML tools: still work, but are marked deprecated", () => {
  it("descriptions start with the notice; email and the new tools do not", () => {
    const byName = new Map(PLEXO_MCP_TOOLS.map((t) => [t.name, t.description as string]));
    for (const name of Object.keys(DEPRECATED_TOOLS)) expect(byName.get(name)!.startsWith(DEPRECATED_PREFIX), name).toBe(true);
    for (const raw of ["create_raw_landing_page", "publish_raw_landing_page", "update_raw_landing_page"]) {
      expect(byName.get(raw)).toMatch(/not editable in Plexo's visual editor/);
      expect(byName.get(raw)).toMatch(/hand-written HTML/);
    }
    for (const name of ["create_email_template", "update_landing_page_page", "publish_existing_landing_page", "page_describe", "page_edit", "page_create_from_template", "page_publish", "blog_layout_edit"]) {
      expect(byName.get(name), name).toBeTruthy();
      expect(byName.get(name)!.startsWith("[DEPRECATED"), name).toBe(false);
    }
    expect(byName.get("page_create_from_template")).toMatch(/real|replace/i);
  });

  it("flag off: classic tools behave as before (V1 rows) and results carry `deprecation`", async () => {
    const c = await call("create_landing_page", { name: "Old", designJson: v1Design("HELLO") });
    expect(h.templates.get(c.templateId)!.designFormat).toBe("v1");
    expect(c.deprecation).toMatchObject({ tool: "create_landing_page", replacement: "page_create_from_template", removalAfterDays: 90 });
    const u = await call("update_template", { templateId: c.templateId, designJson: v1Design("EDITED") });
    expect(u.success).toBe(true);
    expect(u.deprecation.replacement).toBe("page_describe + page_edit");
    expect(h.templates.get(c.templateId)!.compiledHtml).toContain("EDITED");
    const raw = await call("create_raw_landing_page", { name: "Raw", htmlContent: "<!doctype html><html><body>hi</body></html>" });
    expect(raw.deprecation.tool).toBe("create_raw_landing_page");
    expect(h.templates.get(raw.templateId)).toMatchObject({ sourceType: "RAW_UPLOAD" });
  });

  it("email stays classic and carries no deprecation field", async () => {
    const e = await call("create_email_template", { name: "News", designJson: v1Design("MAIL") });
    expect(e.success).toBe(true);
    expect(e.deprecation).toBeUndefined();
    expect(h.templates.get(e.templateId)!.designFormat).toBe("v1");
  });

  it("classic write tools refuse a V2 page in plain words naming the replacement", async () => {
    const r = await call("page_create_from_template", { name: "Home" });
    await expect(call("update_template", { templateId: r.templateId, designJson: v1Design("x") })).rejects.toThrow(/page_describe.*page_edit.*page_publish/);
    await expect(call("update_raw_landing_page", { templateId: r.templateId, htmlContent: "<html></html>" })).rejects.toThrow(/new visual editor/);
    await expect(call("create_landing_page_subpage", { parentTemplateId: r.templateId, name: "About", designJson: v1Design("x") })).rejects.toThrow(/page_create_from_template/);
    expect(h.templates.get(r.templateId)!.designFormat).toBe("v2");
  });
});

describe("TEMPLATES_V2_NEW on: the old create/publish tools produce V2", () => {
  beforeEach(() => {
    process.env.TEMPLATES_V2_NEW = "true";
  });

  it("create_landing_page converts a classic design as a fallback and says so", async () => {
    const c = await call("create_landing_page", { name: "Legacy client", designJson: v1Design("CONVERTED COPY") });
    const row = h.templates.get(c.templateId)!;
    expect(row.designFormat).toBe("v2");
    expect(row.compiledHtml).toContain("CONVERTED COPY");
    expect(c).toMatchObject({ success: true, convertedFromClassic: true, designFormat: "v2" });
    expect(c.conversionFidelity).toMatch(/exact|approximate|partial/);
    expect(c.deprecation.message).toMatch(/converted to the new visual editor/);
    expect(c.deprecation.replacement).toBe("page_create_from_template");
  });

  it("with no design it builds the complete landing template, not a blank page", async () => {
    const c = await call("create_landing_page", { name: "Fresh" });
    const row = h.templates.get(c.templateId)!;
    expect(row.designFormat).toBe("v2");
    expect(row.designJson.pages[0].rootNode.children.length).toBeGreaterThan(4);
    expect(c.deprecation).toBeTruthy();
  });

  it("publish_landing_page builds V2 and connects the domain", async () => {
    const p = await call("publish_landing_page", { name: "Live one", designJson: v1Design("HI"), domain: "liveone" });
    expect(h.templates.get(p.templateId)!.designFormat).toBe("v2");
    expect(p).toMatchObject({ domain: "liveone.pages.test", publishedUrl: "https://liveone.pages.test", convertedFromClassic: true });
    expect(p.deprecation).toBeTruthy();
  });

  it("the plan's site limit still applies, in plain words", async () => {
    for (let i = 0; i < 5; i++) await call("create_landing_page", { name: `S${i}` }, FREE);
    await expect(call("create_landing_page", { name: "Sixth" }, FREE)).rejects.toThrow(/limit of 5 sites/);
  });

  it("a malformed classic design is still refused with the old schema message", async () => {
    await expect(call("create_landing_page", { name: "Bad", designJson: { body: { rows: [{ nope: true }] } } })).rejects.toThrow(/designJson failed schema validation/);
  });

  it("classic pages that already exist keep working with the classic tools", async () => {
    seedClassic("legacy");
    const u = await call("update_template", { templateId: "legacy", designJson: v1Design("STILL V1") });
    expect(u.success).toBe(true);
    expect(h.templates.get("legacy")!.designFormat).toBe("v1");
  });
});
