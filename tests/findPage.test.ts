import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// find_page: "the shop page" → the right page across every site, with what's on it.

const h = vi.hoisted(() => ({
  templates: new Map<string, Record<string, any>>(),
  commerce: new Map<string, Record<string, any>>(),
  blog: new Map<string, Record<string, any>>(),
  layouts: new Map<string, Record<string, any>>(),
}));

vi.mock("@/server/authDynamo", () => ({ auth: vi.fn(), dynamoAdapter: {} }));
vi.mock("@/lib/db/contentEntities", async (orig) => ({
  ...(await orig<object>()),
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.templates.get(id) ?? null }) }),
    query: {
      byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.parentId === parentId) }) }),
      byOrg: ({ organizationId }: { organizationId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.organizationId === organizationId) }) }),
    },
    scan: { where: () => ({ go: async () => ({ data: [] }) }) },
  },
  SiteLayout: { get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.layouts.get(templateId) ?? null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
  BlogSite: { get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.blog.get(templateId) ?? null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/db/commerceEntities", async (orig) => ({
  ...(await orig<object>()),
  CommerceSettings: { get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.commerce.get(templateId) ?? null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
}));

import { dispatchMcpTool } from "@/lib/mcp/dispatchMcpTool";
import { pickPage, rankPages, type PageCandidate } from "@/lib/sites/findPage";
import { htmlOutline } from "@/lib/sites/htmlOutline";
import { scoreTemplate, tagTemplate } from "@/lib/sites/siteTemplates";

const OWNER = { userId: "u1", organizationId: "o1", subscriptionPlan: "ULTRA", customDomainLimit: null, role: null } as any;

const page = (id: string, extra: Record<string, any>) =>
  h.templates.set(id, { id, organizationId: "o1", userId: "u1", kind: "LANDING_PAGE", sourceType: "BUILDER", designFormat: "v1", designJson: { body: { rows: [] } }, compiledHtml: "", ...extra });

beforeEach(() => {
  h.templates.clear();
  h.commerce.clear();
  h.blog.clear();
  h.layouts.clear();
});

describe("rankPages", () => {
  const c = (templateId: string, siteName: string, name: string, route: string | null, kind: PageCandidate["kind"] = "page"): PageCandidate => ({ templateId, siteId: siteName, siteName, name, route, kind, designFormat: "v2" });
  const all = [
    c("h1", "Crumbs", "Crumbs", "/", "home"), c("s1", "Crumbs", "Shop", "/store", "shop"), c("p1", "Crumbs", "Our prices", "/pricing"), c("a1", "Crumbs", "About", "/about"),
    c("h2", "Kicks", "Kicks", "/", "home"), c("s2", "Kicks", "Store", "/store", "shop"), c("b2", "Kicks", "Blog", "/blog", "blog-listing"), c("bp2", "Kicks", "Blog post page", null, "blog-post-layout"),
    c("m2", "Kicks", "Menu at the top (every page)", null, "site-header"),
  ];

  it("understands everyday words and synonyms", () => {
    expect(pickPage(rankPages("pricing", all)).match?.templateId).toBe("p1");
    expect(pickPage(rankPages("the about us page", all)).match?.templateId).toBe("a1");
    expect(pickPage(rankPages("the navigation", all)).match?.templateId).toBe("m2");
    expect(pickPage(rankPages("the blog", all)).match?.templateId).toBe("b2");
  });

  it("is unsure when two sites both fit, and sure when the site is named", () => {
    const { match, tied } = pickPage(rankPages("look at the shop page", all));
    expect(match).toBeNull();
    expect(tied.map((t) => t.templateId).sort()).toEqual(["s1", "s2"]);
    expect(pickPage(rankPages("the shop page on Kicks", all)).match?.templateId).toBe("s2");
    expect(pickPage(rankPages("Crumbs storefront", all)).match?.templateId).toBe("s1");
  });

  it("a site's name alone means its home page", () => {
    expect(pickPage(rankPages("Kicks", all)).match?.templateId).toBe("h2");
  });

  it("finds nothing for unrelated words", () => {
    expect(rankPages("spaceship", all)).toEqual([]);
  });
});

describe("htmlOutline", () => {
  it("reads headings, text, list items, links and pictures in order, without scripts or repeats", () => {
    const html = `<html><head><title>x</title><style>.a{}</style></head><body><nav><a href="/">Home</a><a href="/">Home</a></nav>
      <h1>Fresh bread &amp; cakes</h1><p>Baked every <strong>morning</strong>.</p><ul><li>Sourdough</li><li>Red velvet</li></ul>
      <img src="/cake.jpg" alt="A cake"><a href="/store" class="btn">Order now</a><script>alert(1)</script><button>Subscribe</button></body></html>`;
    const out = htmlOutline(html);
    expect(out.split("\n")).toEqual(["[Home → /]", "# Fresh bread & cakes", "Baked every morning.", "- Sourdough", "- Red velvet", "(picture: A cake)", "[Order now → /store]", "[Subscribe]"]);
    expect(out).not.toContain("alert");
  });

  it("caps its length", () => {
    expect(htmlOutline(`<body>${"<p>word word word</p>".repeat(2000)}</body>`, 500).length).toBeLessThanOrEqual(520);
  });
});

describe("find_page", () => {
  it("finds a classic shop page by name across sites and shows what's on it", async () => {
    page("root1", { name: "Crumbs" });
    page("shop1", { name: "Shop", parentId: "root1", slug: "store", compiledHtml: "<body><h1>Shop our cakes</h1><p>Fresh every day.</p></body>" });
    h.commerce.set("root1", { templateId: "root1", storefrontTemplateId: "shop1" });
    page("root2", { name: "Ledgerly" });
    page("pricing2", { name: "Pricing", parentId: "root2", slug: "pricing" });

    const r = await dispatchMcpTool("find_page", { query: "look at the shop page" }, OWNER);
    expect(r.found).toBe(true);
    expect(r.page).toMatchObject({ templateId: "shop1", site: "Crumbs", route: "/store", kind: "shop", designFormat: "classic" });
    expect(r.details.page.outline).toContain("# Shop our cakes");
    expect(r.howToChange).toMatch(/update_template/);
  });

  it("asks which one when it's unclear", async () => {
    page("root1", { name: "Crumbs" });
    page("shop1", { name: "Shop", parentId: "root1", slug: "store" });
    page("root2", { name: "Kicks" });
    page("shop2", { name: "Shop", parentId: "root2", slug: "store" });
    const r = await dispatchMcpTool("find_page", { query: "the shop" }, OWNER);
    expect(r).toMatchObject({ found: false, ambiguous: true });
    expect(r.candidates.map((c: any) => c.site).sort()).toEqual(["Crumbs", "Kicks"]);
    const narrowed = await dispatchMcpTool("find_page", { query: "the shop", siteId: "root2" }, OWNER);
    expect(narrowed.page.templateId).toBe("shop2");
  });

  it("reads a hand-written page and finds shared layouts", async () => {
    page("root1", { name: "Ada Studio", sourceType: "RAW_UPLOAD", compiledHtml: "<body><h1>Ada Studio</h1><p>Wedding photography in Abuja.</p></body>" });
    page("hdr", { name: "Site Header", isSiteLayoutFragment: true });
    h.layouts.set("root1", { templateId: "root1", enabled: true, headerTemplateId: "hdr" });
    const home = await dispatchMcpTool("find_page", { query: "my homepage" }, OWNER);
    expect(home.page).toMatchObject({ templateId: "root1", designFormat: "raw-html" });
    expect(home.details.page.outline).toContain("Wedding photography");
    expect(home.howToChange).toMatch(/update_raw_landing_page/);
    const menu = await dispatchMcpTool("find_page", { query: "the menu" }, OWNER);
    expect(menu.page).toMatchObject({ templateId: "hdr", kind: "site-header" });
  });

  it("says so when the account has no sites", async () => {
    expect(await dispatchMcpTool("find_page", { query: "shop" }, OWNER)).toMatchObject({ found: false });
  });
});

describe("site template tags", () => {
  it("tags a marketplace template by industry and style, and ranks fits first", () => {
    const tags = tagTemplate({ name: "Velvet", category: "Fashion boutique", description: "An elegant, luxury storefront" });
    expect(tags).toEqual({ industry: "retail", style: "elegant" });
    const want = { industry: "retail" as const, style: "elegant" as const, words: ["luxury"] };
    expect(scoreTemplate(tags, "Velvet luxury", want)).toBeGreaterThan(scoreTemplate({ industry: "tech", style: "minimal" }, "SaaS", want));
  });
});
