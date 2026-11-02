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
  products: new Map<string, Record<string, any>>(),
  commerceCalls: [] as { tool: string; args: any }[],
  commerceSettings: { enabled: true } as Record<string, any> | null,
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
  CommerceSettings: { get: () => ({ go: async () => ({ data: h.commerceSettings }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
  CommerceProduct: { get: ({ templateId, id }: { templateId: string; id: string }) => ({ go: async () => ({ data: h.products.get(`${templateId}/${id}`) ?? null }) }) },
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

vi.mock("@/lib/mcp/commerceTools", async (orig) => ({
  ...(await orig<object>()),
  handleCommerceTool: vi.fn(async (tool: string, args: any) => {
    h.commerceCalls.push({ tool, args });
    if (tool === "create_commerce_product") {
      const product = { id: "new-product", templateId: args.templateId, name: args.name, kind: args.kind, priceMinor: args.priceMinor, active: true };
      h.products.set(`${args.templateId}/new-product`, product);
      return { success: true, product };
    }
    if (tool === "update_commerce_settings") h.commerceSettings = { ...(h.commerceSettings ?? {}), enabled: true, ...(args.paymentProvider ? { paymentProvider: args.paymentProvider } : {}) };
    return { success: true };
  }),
}));

import { dispatchMcpTool } from "@/lib/mcp/dispatchMcpTool";
import { blankV2Design } from "@/lib/v2/design";
import { applyToDesign } from "@/lib/mcp/v2Pages";
import { hasProductMarker } from "@/lib/commerce/embedSnippets";

const ULTRA = { userId: "u1", organizationId: "o1", subscriptionPlan: "ULTRA", customDomainLimit: null, role: null } as any;
const FREE = { ...ULTRA, subscriptionPlan: "FREE" } as any;
const sell = (args: any, who = ULTRA) => dispatchMcpTool("sell_product_on_page", args, who);

const COURSE = "course-1";
const base = { userId: "u1", organizationId: "o1", kind: "LANDING_PAGE", compiledHtml: "" };
const seedRaw = (id: string, html: string, extra: Record<string, any> = {}) =>
  h.templates.set(id, { ...base, id, name: "Course site", designFormat: "v1", sourceType: "RAW_UPLOAD", compiledHtml: html, ...extra });
const seedVisual = (id: string, extra: Record<string, any> = {}) =>
  h.templates.set(id, { ...base, id, name: "Home", designFormat: "v2", sourceType: "BUILDER", designJson: blankV2Design(), compiledHtml: "<html></html>", ...extra });

beforeEach(() => {
  h.templates.clear();
  h.revisions.length = 0;
  h.domains.length = 0;
  h.products.clear();
  h.commerceSettings = { enabled: true, paymentProvider: "PLATFORM_PAYSTACK" };
  h.commerceCalls.length = 0;
  h.products.set(`site/${COURSE}`, { id: COURSE, templateId: "site", name: "AI Video Course", kind: "DIGITAL", priceMinor: 500000, active: true });
});

describe("sell_product_on_page", () => {
  it("adds a buy card above the footer of a hand-written page, and doesn't add it twice", async () => {
    seedRaw("site", "<body><main>Hi</main><footer>Bye</footer></body>");
    h.domains.push({ templateId: "site", domain: "course.pages.test" });
    const r = await sell({ siteId: "site", productId: COURSE });
    expect(r).toMatchObject({ success: true, kind: "html", alreadyThere: false, live: true, publishedUrl: "https://course.pages.test" });
    const html = h.templates.get("site")!.compiledHtml as string;
    expect(hasProductMarker(html, COURSE)).toBe(true);
    expect(html.indexOf("data-plexo-product-id")).toBeLessThan(html.indexOf("<footer>"));
    const again = await sell({ siteId: "site", productId: COURSE });
    expect(again.alreadyThere).toBe(true);
    expect((h.templates.get("site")!.compiledHtml as string).match(/data-plexo-product-id/g)).toHaveLength(1);
  });

  it("adds a Sell a product section to a visual page and publishes it when it's live and nothing else is waiting", async () => {
    seedVisual("site");
    h.domains.push({ templateId: "site", domain: "course.pages.test" });
    const r = await sell({ siteId: "site", productId: COURSE, heading: "Learn AI video" });
    expect(r).toMatchObject({ success: true, kind: "visual", alreadyThere: false, live: true });
    const row = h.templates.get("site")!;
    expect(JSON.stringify(row.designJson)).toContain(COURSE);
    expect(row.compiledHtml).toContain(`data-plexo-product-id="${COURSE}"`);
    expect(row.compiledHtml).toContain('data-plexo-commerce-mode="buy"');
    expect(row.compiledHtml).toContain("Learn AI video");
    expect(row.draftJson).toBeUndefined();
    expect(h.revisions).toHaveLength(1);
  });

  it("leaves a visual page as a working copy when it has no address yet", async () => {
    seedVisual("site");
    const r = await sell({ siteId: "site", productId: COURSE });
    expect(r).toMatchObject({ kind: "visual", live: false, publishedUrl: null });
    expect(r.message).toContain("Publish the page");
    expect(JSON.stringify(h.templates.get("site")!.draftJson)).toContain(COURSE);
  });

  it("won't publish someone else's unfinished edits along with the product", async () => {
    seedVisual("site", { draftJson: blankV2Design() });
    h.domains.push({ templateId: "site", domain: "course.pages.test" });
    const r = await sell({ siteId: "site", productId: COURSE });
    expect(r).toMatchObject({ kind: "visual", live: false });
    expect(r.message).toContain("other unpublished changes");
    expect(h.revisions).toHaveLength(0);
  });

  it("adds a product block to the end of a classic-editor page", async () => {
    h.templates.set("site", { ...base, id: "site", name: "Home", designFormat: "v1", sourceType: "BUILDER", designJson: { body: { style: {}, rows: [] } }, compiledHtml: "<p>old</p>" });
    const r = await sell({ siteId: "site", productId: COURSE });
    expect(r).toMatchObject({ kind: "classic", alreadyThere: false, live: true });
    const row = h.templates.get("site")!;
    expect(JSON.stringify(row.designJson)).toContain(COURSE);
    expect(row.compiledHtml).toContain(`data-plexo-product-id="${COURSE}"`);
    expect(row.compiledHtml).toContain('data-plexo-commerce-mode="buy"');
    expect((await sell({ siteId: "site", productId: COURSE })).alreadyThere).toBe(true);
  });

  it("hands a React app the line to place, without touching it", async () => {
    seedRaw("site", "", { sourceType: "REACT_PROJECT", compiledHtml: "" });
    const r = await sell({ siteId: "site", productId: COURSE, buttonLabel: "Enrol now" });
    expect(r).toMatchObject({ kind: "app", alreadyThere: false });
    expect(r.snippet).toBe(`<div data-plexo-commerce-product data-plexo-product-id="${COURSE}" data-plexo-commerce-mode="buy" data-plexo-commerce-button-label="Enrol now" />`);
    expect(h.templates.get("site")!.compiledHtml).toBe("");
  });

  it("explains, in plain words, what can't be done", async () => {
    seedRaw("site", "<body></body>");
    h.products.set("site/svc", { id: "svc", templateId: "site", name: "Consultation", kind: "SERVICE", priceMinor: 100, active: true });
    await expect(sell({ siteId: "site", productId: "svc" })).rejects.toThrow(/booked|book/);
    await expect(sell({ siteId: "site", productId: "nope" })).rejects.toThrow(/can't find that product/);
    await expect(sell({ siteId: "other", productId: COURSE })).rejects.toThrow(/can't find a site/);
    seedRaw("elsewhere", "<body></body>", { organizationId: "someone-else" });
    await expect(sell({ siteId: "elsewhere", productId: COURSE })).rejects.toThrow(/can't find a site/);
  });

  it("switches Commerce on by itself, and tells the owner, rather than leaving a button that can't work", async () => {
    seedRaw("site", "<body></body>");
    h.commerceSettings = { enabled: false, paymentProvider: "PLATFORM_PAYSTACK" };
    const r = await sell({ siteId: "site", productId: COURSE });
    expect(h.commerceCalls).toEqual([{ tool: "update_commerce_settings", args: { templateId: "site", enabled: true } }]);
    expect(r.warnings.join(" ")).toMatch(/switched Commerce on/);
  });

  it("warns that a physical product can't be completed on a home-page-only plan", async () => {
    seedRaw("site", "<body></body>");
    h.products.set("site/tee", { id: "tee", templateId: "site", name: "Tee", kind: "PHYSICAL", priceMinor: 100, active: true });
    const r = await sell({ siteId: "site", productId: "tee" }, FREE);
    expect(r.warnings.join(" ")).toMatch(/physical product needs delivery details/);
    const digital = await sell({ siteId: "site", productId: COURSE }, FREE);
    expect(digital.warnings.join(" ")).not.toMatch(/physical/);
  });

  it("only offers a page of the same site", async () => {
    seedRaw("site", "<body></body>");
    seedRaw("page-of-another-site", "<body></body>", { parentId: "another-root" });
    seedRaw("another-root", "<body></body>");
    await expect(sell({ siteId: "site", productId: COURSE, pageId: "page-of-another-site" })).rejects.toThrow(/different site/);
  });
});


// The aivideocreationcourse.plexopages.com situation: a hand-written page whose four buttons go to a
// hosted payment link, no product, and Commerce never set up.
const FLW = "https://flutterwave.com/pay/aivideocreationcourse";
const coursePage = `<!DOCTYPE html><html><head><style>a[href="${FLW}"]{color:red}</style><script>var link="<a href='${FLW}'>x</a>";</script></head><body>
<main><a class="btn" href="${FLW}" data-checkout target="_blank" rel="noopener">Grab the Skill — Today!</a>
<p>Learn it.</p><a class="btn" href='${FLW}' data-checkout>Grab the Skill — Today!</a>
<a href="https://twitter.com/meerhq">Follow</a></main><footer>© Meer HQ</footer></body></html>`;

describe("selling a course from a page that already has a payment link", () => {
  beforeEach(() => {
    h.commerceSettings = null; // never set up
    h.domains.push({ templateId: "site", domain: "aivideocreationcourse.pages.test" });
  });

  it("creates the product, sets up payments, and turns the page's own buttons into the checkout — keeping its design", async () => {
    seedRaw("site", coursePage);
    const r = await sell({ siteId: "site", name: "AI Video Creation Course", price: 5000, deliveryUrl: "https://courses.example/ai-video" });
    expect(r).toMatchObject({ success: true, kind: "html", createdProduct: true, convertedLinks: 2, addedCard: false, alreadyThere: false, live: true, productId: "new-product", buyLink: "#plexo-buy-new-product" });

    expect(h.commerceCalls.map((c) => c.tool)).toEqual(["create_commerce_product", "update_commerce_settings"]);
    expect(h.commerceCalls[0].args).toMatchObject({ templateId: "site", name: "AI Video Creation Course", kind: "DIGITAL", priceMinor: 500000, digitalDeliveryMethod: "EXTERNAL_LINK", digitalExternalUrl: "https://courses.example/ai-video" });
    expect(h.commerceCalls[1].args).toEqual({ templateId: "site", enabled: true, paymentProvider: "PLATFORM_PAYSTACK" });

    const html = h.templates.get("site")!.compiledHtml as string;
    expect(html).toContain('<a class="btn" href="#plexo-buy-new-product" data-checkout>Grab the Skill — Today!</a>');
    expect(html).toContain(`<a class="btn" href="#plexo-buy-new-product" data-checkout>Grab the Skill — Today!</a>`);
    expect(html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "")).not.toContain("flutterwave"); // gone from the page itself (the same text inside <style>/<script> is left alone, below)
    expect(html).toContain('href="https://twitter.com/meerhq"'); // other links untouched
    expect(html).toContain(`var link="<a href='${FLW}'>x</a>"`); // script text untouched
    expect(html).toContain(`a[href="${FLW}"]{color:red}`); // style text untouched
    expect(html).not.toContain("data-plexo-commerce-product"); // no second way to buy added
    expect(r.message).toMatch(/^Created "AI Video Creation Course" and switched the 2 payment buttons on "Course site" to the new checkout/);
    expect(r.warnings.join(" ")).toMatch(/Plexo's Paystack/);
    expect(r.warnings.join(" ")).toMatch(/instead of the old payment link/);
  });

  it("with no delivery link, still works — and warns the owner to add one", async () => {
    seedRaw("site", coursePage);
    const r = await sell({ siteId: "site", name: "Course", price: 5000 });
    expect(h.commerceCalls[0].args).toMatchObject({ digitalDeliveryMethod: "ACCESS_LIST" });
    expect(r.warnings.join(" ")).toMatch(/add its link or file to the product/);
  });

  it("is safe to run again", async () => {
    seedRaw("site", coursePage);
    await sell({ siteId: "site", name: "Course", price: 5000 });
    const again = await sell({ siteId: "site", productId: "new-product" });
    expect(again).toMatchObject({ alreadyThere: true, convertedLinks: 0, addedCard: false });
  });

  it("adds a buy card instead when the page has no payment link", async () => {
    seedRaw("site", "<body><main>Hi</main><footer>Bye</footer></body>");
    const r = await sell({ siteId: "site", name: "Course", price: 5000 });
    expect(r).toMatchObject({ convertedLinks: 0, addedCard: true });
    expect(hasProductMarker(h.templates.get("site")!.compiledHtml as string, "new-product")).toBe(true);
  });

  it("leaves several different payment links alone and asks which is this product's", async () => {
    const two = `<body><a href="https://flutterwave.com/pay/course-one">One</a><a href="https://selar.co/course-two">Two</a><footer></footer></body>`;
    seedRaw("site", two);
    const r = await sell({ siteId: "site", name: "Course", price: 5000 });
    expect(r.convertedLinks).toBe(0);
    expect(r.unclearLinks).toEqual(["https://flutterwave.com/pay/course-one", "https://selar.co/course-two"]);
    expect(r.warnings.join(" ")).toMatch(/2 different payment links/);
    expect(r.addedCard).toBe(true);
    const picked = await sell({ siteId: "site", productId: "new-product", paymentLink: "course-one" });
    expect(picked.convertedLinks).toBe(1);
    const html = h.templates.get("site")!.compiledHtml as string;
    expect(html).toContain('href="#plexo-buy-new-product">One');
    expect(html).toContain('href="https://selar.co/course-two"');
  });

  it("keeps an owner's own payment setup", async () => {
    seedRaw("site", coursePage);
    h.commerceSettings = { enabled: true, paymentProvider: "BYO_PAYSTACK", paystackLiveSecretKeyEncrypted: "enc" };
    await sell({ siteId: "site", name: "Course", price: 5000 });
    expect(h.commerceCalls.map((c) => c.tool)).toEqual(["create_commerce_product"]);
  });

  it("asks for what's missing in plain words", async () => {
    seedRaw("site", coursePage);
    await expect(sell({ siteId: "site", name: "Course" })).rejects.toThrow(/name and price/);
    await expect(sell({ siteId: "site" })).rejects.toThrow(/Which product/);
  });

  it("switches the buttons of a visual page — ready-made sections and hand-built elements — and publishes it", async () => {
    // An AI-built hero whose main button goes to the hosted payment link…
    const design = applyToDesign(blankV2Design(), [{ op: "addSection", kind: "hero", content: { headline: "Learn AI video", cta: { label: "Grab the Skill — Today!", href: FLW }, cta2: { label: "Pricing", href: "#pricing" } } }]).design;
    // …and a hand-designed section with its own payment button.
    const custom = applyToDesign(design, [{ op: "addCustomSection", pageId: design.pages[0].id, element: { type: "section", children: [{ type: "button", content: "Buy", props: { href: FLW } }] } }]);
    expect(custom.reports[0].ok).toBe(true);
    seedVisual("site", { designJson: custom.design });

    const r = await sell({ siteId: "site", name: "Course", price: 5000 });
    expect(r).toMatchObject({ kind: "visual", convertedLinks: 2, addedCard: false, live: true });
    const row = h.templates.get("site")!;
    const stored = JSON.stringify(row.designJson);
    expect(stored).not.toContain("flutterwave");
    expect(stored).toContain("#plexo-buy-new-product");
    expect(stored).toContain("#pricing"); // the other button is untouched
    expect(row.compiledHtml).not.toContain("flutterwave");
    expect(row.compiledHtml.match(/href="#plexo-buy-new-product"/g)).toHaveLength(2);
    expect(row.draftJson).toBeUndefined();
  });

  it("switches the buttons of a classic page", async () => {
    h.templates.set("site", { ...base, id: "site", name: "Home", designFormat: "v1", sourceType: "BUILDER", designJson: { body: { style: {}, rows: [{ id: "r", style: {}, columns: [{ id: "c", width: "100%", elements: [{ id: "b", type: "button", style: {}, attributes: { text: "Buy", href: FLW } }] }] }] } }, compiledHtml: "<p>old</p>" });
    const r = await sell({ siteId: "site", name: "Course", price: 5000 });
    expect(r).toMatchObject({ kind: "classic", convertedLinks: 1, addedCard: false });
    expect(JSON.stringify(h.templates.get("site")!.designJson)).toContain("#plexo-buy-new-product");
  });

  it("tells an app's AI which link to change", async () => {
    seedRaw("site", "", { sourceType: "REACT_PROJECT" });
    const r = await sell({ siteId: "site", name: "Course", price: 5000 });
    expect(r.kind).toBe("app");
    expect(r.message).toContain('href="#plexo-buy-new-product"');
    expect(r.message).toContain('data-plexo-buy="new-product"');
  });
});
