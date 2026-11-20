import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// site_create end to end against in-memory stand-ins for the entities: the real planner, page
// builder (SDK), createV2Page, Site layout, compile and recompile — only the Commerce and Blog
// tool handlers are stand-ins (they have their own tests), recording what they were asked.

const h = vi.hoisted(() => ({
  templates: new Map<string, Record<string, any>>(),
  layouts: new Map<string, Record<string, any>>(),
  blogSites: new Map<string, Record<string, any>>(),
  commerce: new Map<string, Record<string, any>>(),
  calls: [] as Array<{ tool: string; args: any }>,
}));
const { store } = vi.hoisted(() => ({
  store: (map: Map<string, Record<string, any>>, key: string) => ({
  get: (k: Record<string, string>) => ({ go: async () => ({ data: map.get(k[key]) ?? null }) }),
  create: (row: Record<string, any>) => ({ go: async () => { map.set(row[key], { ...row }); return { data: row }; } }),
  patch: (k: Record<string, string>) => {
    const set: Record<string, any> = {};
    const b: any = { set: (v: any) => { Object.assign(set, v); return b; }, remove: () => b, go: async () => { const row = map.get(k[key]) ?? { [key]: k[key] }; Object.assign(row, set); map.set(k[key], row); return { data: row }; } };
    return b;
  },
  scan: { where: () => ({ go: async () => ({ data: [] }) }) },
}),
}));

vi.mock("@/server/authDynamo", () => ({ auth: vi.fn(), dynamoAdapter: {} }));

vi.mock("@/lib/db/contentEntities", async (orig) => ({
  ...(await orig<object>()),
  Template: {
    ...store(h.templates, "id"),
    create: (row: Record<string, any>) => ({ go: async () => { h.templates.set(row.id, { designFormat: "v1", sourceType: "BUILDER", ...row }); return { data: row }; } }),
    query: {
      byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.parentId === parentId) }) }),
      byOrg: ({ organizationId }: { organizationId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.organizationId === organizationId) }) }),
    },
  },
  SiteLayout: store(h.layouts, "templateId"),
  BlogSite: store(h.blogSites, "templateId"),
  PublishedDomain: { query: { primary: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/db/commerceEntities", async (orig) => ({ ...(await orig<object>()), CommerceSettings: store(h.commerce, "templateId") }));

vi.mock("@/lib/mcp/commerceTools", async (orig) => ({
  ...(await orig<object>()),
  handleCommerceTool: vi.fn(async (tool: string, args: any) => {
    h.calls.push({ tool, args });
    if (tool === "update_commerce_settings") {
      // What ensureStorefrontLayout does with an existing /store page: adopt it.
      const shop = [...h.templates.values()].find((t) => t.parentId === args.templateId && t.slug === "store");
      h.commerce.set(args.templateId, { templateId: args.templateId, enabled: true, storefrontTemplateId: shop?.id });
      return { success: true };
    }
    if (tool === "create_commerce_product") {
      if (args.name === "Broken") throw new Error("price too low");
      return { success: true, product: { id: `p-${args.name}` } };
    }
    return { success: true };
  }),
}));
vi.mock("@/lib/mcp/blogTools", async (orig) => ({
  ...(await orig<object>()),
  handleBlogTool: vi.fn(async (tool: string, args: any) => {
    h.calls.push({ tool, args });
    if (tool === "update_blog_settings") h.blogSites.set(args.templateId, { templateId: args.templateId, enabled: true });
    return { success: true };
  }),
}));

import { dispatchMcpTool, PLEXO_MCP_TOOLS } from "@/lib/mcp/dispatchMcpTool";
import { planSite, SiteBuildError } from "@/lib/sites/siteBuilder";
import { menuWithPage } from "@/lib/sites/siteNav";

const ULTRA = { userId: "u1", organizationId: "o1", subscriptionPlan: "ULTRA", customDomainLimit: null, role: null } as any;
const FREE = { ...ULTRA, subscriptionPlan: "FREE" } as any;

const blocksOf = (row: Record<string, any>) => (row.designJson.pages[0].rootNode.children ?? []).map((c: any) => c.props?.block).filter(Boolean);

const BAKERY = {
  brief: {
    name: "Crumbs Bakery",
    about: "Celebration cakes and fresh bread, baked every morning in Lekki. Order online for delivery across Lagos.",
    tagline: "Cakes worth celebrating",
    industry: "bakery",
    tone: "warm and friendly",
    contact: { email: "hello@crumbs.ng", phone: "+234 801 234 5678", address: "12 Admiralty Way, Lekki" },
    socials: [{ network: "instagram", url: "https://instagram.com/crumbs" }],
  },
  pages: [
    { type: "home", content: { hero: { cta: { label: "Order a cake", href: "/store" } }, features: { heading: "Why Lagos loves Crumbs", items: [{ icon: "heart", title: "Baked fresh daily", text: "Every loaf and layer is made the morning you get it." }, { icon: "truck", title: "Same-day delivery", text: "Order by noon, eat it tonight." }] } } },
    { type: "store", name: "Shop" },
    { type: "about", content: { hero: { headline: "Baking since 2015" } } },
    { type: "blog" },
    { type: "contact" },
  ],
  store: { currency: "NGN", products: [{ name: "Red velvet cake", price: 25000, description: "Six inches of joy." }, { name: "Sourdough loaf", price: 4500 }, { name: "Broken", price: 1 }] },
  blog: { posts: [{ title: "How to pick a birthday cake", contentHtml: "<p>Start with who it's for.</p>" }] },
};

beforeEach(() => {
  h.templates.clear();
  h.layouts.clear();
  h.blogSites.clear();
  h.commerce.clear();
  h.calls.length = 0;
});

describe("planSite", () => {
  it("needs a name", () => {
    expect(() => planSite({ brief: {} })).toThrow(SiteBuildError);
  });

  it("puts home first, the shop at /store, the blog at /blog, and builds the menu from the real pages", () => {
    const plan = planSite(BAKERY as any);
    expect(plan.home).toMatchObject({ type: "home", path: "/" });
    expect(plan.pages.map((p) => p.path)).toEqual(["/store", "/about", "/contact"]);
    expect(plan.blog?.path).toBe("/blog");
    expect(plan.store).toBe(true);
    expect(plan.nav.map((l) => l.label)).toEqual(["Home", "Shop", "About", "Blog", "Contact"]);
    expect(plan.navCta).toEqual({ label: "Shop now", href: "/store" });
    expect(plan.choices).toMatchObject({ industry: "restaurant", style: "warm", neutrals: "warm" });
  });

  it("suggests pages from the goal when none are given, and understands everyday page names", () => {
    expect(planSite({ brief: { name: "Kicks" }, goal: "store" }).pages.map((p) => p.type)).toContain("store");
    const plan = planSite({ brief: { name: "X" }, pages: [{ type: "shop" }, { type: "prices" }, { type: "spaceship" }, { type: "home" }] } as any);
    expect(plan.pages.map((p) => p.type)).toEqual(["store", "pricing"]);
    expect(plan.warnings.join(" ")).toMatch(/spaceship/);
  });

  it("uses a one-page landing as the home page", () => {
    const plan = planSite({ brief: { name: "Launch" }, pages: [{ type: "landing" }] } as any);
    expect(plan.home.type).toBe("landing");
    expect(plan.pages).toEqual([]);
    expect(plan.nav).toEqual([]);
  });
});

// Building a whole site (pages, shop, blog) in one call is slow on a cold start or a busy machine;
// it took ~5s alone, which hit vitest's default limit.
vi.setConfig({ testTimeout: 30_000 });

describe("site_create", () => {
  it("is in the MCP catalog with the other new tools", () => {
    const names = PLEXO_MCP_TOOLS.map((t) => t.name);
    for (const n of ["site_create", "list_site_templates", "create_site_from_template", "find_page"]) expect(names).toContain(n);
  });

  it("builds a connected, branded, multi-page site with a shop and a blog in one call", async () => {
    const r = await dispatchMcpTool("site_create", BAKERY, ULTRA);
    expect(r.success).toBe(true);
    // SITE_CREATE_SAMPLE=1 prints what was built (a dry-run summary).
    if (process.env.SITE_CREATE_SAMPLE) {
      const sample = { brand: r.brand, nav: r.nav, warnings: r.warnings, pages: r.pages.map((p: any) => ({ type: p.type, route: p.route, layout: p.layout, sections: blocksOf(h.templates.get(p.templateId)!).map((b: any) => `${b.kind}/${b.variant}`) })), store: r.store, blog: r.blog };
      console.log(JSON.stringify(sample, null, 1));
    }
    expect(r.publishedUrl).toBeNull();
    expect(r.suggestedDomains[0]).toBe("crumbs-bakery");

    // Pages: home + shop + about + contact as real pages, the blog at /blog.
    expect(r.pages.map((p: any) => [p.type, p.route])).toEqual([["home", "/"], ["store", "/store"], ["about", "/about"], ["contact", "/contact"], ["blog", "/blog"]]);
    const root = h.templates.get(r.siteId)!;
    expect(root).toMatchObject({ name: "Crumbs Bakery", designFormat: "v2" });
    const shop = h.templates.get(r.pages[1].templateId)!;
    expect(shop).toMatchObject({ parentId: r.siteId, slug: "store", designFormat: "v2" });
    expect(blocksOf(shop).map((b: any) => b.kind)).toContain("shop");

    // One shared menu + footer linking the real pages; pages don't carry their own.
    const layout = h.layouts.get(r.siteId)!;
    expect(layout.enabled).toBe(true);
    const header = blocksOf(h.templates.get(layout.headerTemplateId)!)[0];
    expect(header.kind).toBe("header");
    expect(header.content.brand).toBe("Crumbs Bakery");
    expect(header.content.links.map((l: any) => l.href)).toEqual(["/", "/store", "/about", "/blog", "/contact"]);
    for (const p of r.pages.slice(0, 4)) expect(blocksOf(h.templates.get(p.templateId)!).map((b: any) => b.kind)).not.toContain("header");
    // …and the compiled pages show it.
    expect(h.templates.get(r.pages[2].templateId)!.compiledHtml).toContain("Crumbs Bakery");

    // The brand comes from the brief, not the default blue, and every page has it.
    expect(r.brand).toMatchObject({ industry: "restaurant", style: "warm" });
    expect(r.brand.primary).not.toBe("#266DDC");
    for (const p of r.pages.slice(0, 4)) expect(h.templates.get(p.templateId)!.designJson.designSystem).toBeTruthy();

    // The business's words: brief + content.
    const home = blocksOf(root);
    expect(home.find((b: any) => b.kind === "hero").content).toMatchObject({ headline: "Cakes worth celebrating", cta: { label: "Order a cake", href: "/store" } });
    expect(home.find((b: any) => b.kind === "features").content.heading).toBe("Why Lagos loves Crumbs");
    const about = blocksOf(h.templates.get(r.pages[2].templateId)!);
    expect(about.find((b: any) => b.kind === "hero").content.headline).toBe("Baking since 2015");
    const contact = blocksOf(h.templates.get(r.pages[3].templateId)!);
    expect(contact.find((b: any) => b.kind === "contact").content).toMatchObject({ email: "hello@crumbs.ng", phone: "+234 801 234 5678" });

    // Selling: on with Plexo's payments, products added, a failed one reported.
    expect(h.calls.find((c) => c.tool === "update_commerce_settings")!.args).toMatchObject({ templateId: r.siteId, enabled: true, paymentProvider: "PLATFORM_PAYSTACK", currency: "NGN" });
    expect(h.calls.filter((c) => c.tool === "create_commerce_product").map((c) => c.args.priceMinor)).toEqual([2500000, 450000, 100]);
    expect(r.store.products.map((p: any) => p.name)).toEqual(["Red velvet cake", "Sourdough loaf"]);
    expect(r.warnings.join(" ")).toMatch(/couldn't add "Broken"/);
    expect(h.commerce.get(r.siteId)!.storefrontTemplateId).toBe(shop.id);

    // Blog: on, designed listing + article layouts, the post published.
    const blog = h.blogSites.get(r.siteId)!;
    expect(blog.enabled).toBe(true);
    expect(blocksOf(h.templates.get(blog.listingLayoutTemplateId)!).map((b: any) => b.kind)).toContain("blogList");
    expect(blocksOf(h.templates.get(blog.postLayoutTemplateId)!).map((b: any) => b.kind)).toContain("blogArticle");
    expect(h.calls.find((c) => c.tool === "create_blog_post")!.args).toMatchObject({ title: "How to pick a birthday cake", status: "PUBLISHED" });
  });

  it("different businesses get different layouts and brands", async () => {
    const a = await dispatchMcpTool("site_create", { brief: { name: "Ledgerly", industry: "software", tone: "minimal" }, pages: [{ type: "home" }] }, ULTRA);
    const b = await dispatchMcpTool("site_create", { brief: { name: "Iron Temple", industry: "gym", tone: "bold" }, pages: [{ type: "home" }] }, ULTRA);
    expect(a.pages[0].layout).not.toBe(b.pages[0].layout);
    expect(a.brand.primary).not.toBe(b.brand.primary);
    expect(a.brand.headingFont).not.toBe(b.brand.headingFont);
  });

  it("Free plan: builds one complete page (only the home page can go live) and says so", async () => {
    const r = await dispatchMcpTool("site_create", { brief: { name: "Tiny" }, pages: [{ type: "home" }, { type: "about" }] }, FREE);
    expect(r.pages.length).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/publishes one page/);
  });

  it("refuses plainly without a name, and leaves nothing behind", async () => {
    await expect(dispatchMcpTool("site_create", { brief: {} }, ULTRA)).rejects.toThrow(/business's name/);
    expect(h.templates.size).toBe(0);
  });

  it("a page added later joins the shared menu and keeps the brand, without a second header", async () => {
    const r = await dispatchMcpTool("site_create", { brief: { name: "Crumbs", industry: "bakery" }, pages: [{ type: "home" }, { type: "about" }, { type: "contact" }] }, ULTRA);
    const added = await dispatchMcpTool("page_create_from_template", { name: "Pricing", templateId: "pricing", siteId: r.siteId }, ULTRA);
    const row = h.templates.get(added.templateId)!;
    expect(blocksOf(row).map((b: any) => b.kind)).not.toContain("header");
    expect(row.designJson.designSystem).toEqual(h.templates.get(r.siteId)!.designJson.designSystem);
    const header = blocksOf(h.templates.get(h.layouts.get(r.siteId)!.headerTemplateId)!)[0];
    expect(header.content.links.map((l: any) => l.href)).toEqual(["/", "/about", "/pricing", "/contact"]);
  });
});

describe("menuWithPage", () => {
  const design = (links: Array<{ label: string; href: string }>) => ({ format: "plexo-v2@1", pages: [{ id: "p", name: "H", slug: "h", rootNode: { id: "r", type: "page", children: [{ id: "s", type: "section", props: { block: { kind: "header", content: { links } } } }] } }] }) as any;

  it("adds before Contact, skips duplicates and a full menu", () => {
    expect(menuWithPage(design([{ label: "Home", href: "/" }, { label: "Contact", href: "/contact" }]), "FAQ", "/faq")!.links.map((l) => l.href)).toEqual(["/", "/faq", "/contact"]);
    expect(menuWithPage(design([{ label: "Home", href: "/" }]), "Home", "/")).toBeNull();
    expect(menuWithPage(design(Array.from({ length: 8 }, (_, i) => ({ label: `P${i}`, href: `/p${i}` }))), "X", "/x")).toBeNull();
  });
});
