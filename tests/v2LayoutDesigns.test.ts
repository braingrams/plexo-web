import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-ins for the entities the generators touch (same style as v2TemplatesFlow.test.ts).
const h = vi.hoisted(() => ({
  templates: new Map<string, Record<string, any>>(),
  settings: new Map<string, Record<string, any>>(),
  layout: null as null | Record<string, any>,
}));

vi.mock("@/lib/db/client", () => ({ TABLES: {}, docClient: { send: vi.fn() } }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({ TransactWriteCommand: class {} }));
vi.mock("@/server/slugDynamo", () => ({
  ensureUniqueSlug: async (parentId: string, base: string) => {
    const taken = new Set([...h.templates.values()].filter((t) => t.parentId === parentId).map((t) => t.slug));
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    return slug;
  },
}));

const patchable = (map: Map<string, Record<string, any>>, id: string) => {
  const set: Record<string, any> = {};
  const b: any = {
    set(v: Record<string, any>) { Object.assign(set, v); return b; },
    remove() { return b; },
    go: async () => { const row = map.get(id); if (row) Object.assign(row, set); return { data: row }; },
  };
  return b;
};
vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.templates.get(id) ?? null }) }),
    patch: ({ id }: { id: string }) => patchable(h.templates, id),
    create: (row: Record<string, any>) => ({ go: async () => { h.templates.set(row.id, { designFormat: "v1", ...row }); return { data: row }; } }),
    query: { byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.parentId === parentId) }) }) },
    scan: { where: () => ({ go: async () => ({ data: [] }) }) },
  },
  SiteLayout: { get: () => ({ go: async () => ({ data: h.layout }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
  BlogSite: { get: () => ({ go: async () => ({ data: null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/db/commerceEntities", () => ({
  CommerceSettings: {
    get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.settings.get(templateId) ?? null }) }),
    create: (row: Record<string, any>) => ({ go: async () => { h.settings.set(row.templateId, row); return { data: row }; } }),
    patch: ({ templateId }: { templateId: string }) => patchable(h.settings, templateId),
    scan: { where: () => ({ go: async () => ({ data: [] }) }) },
  },
}));

import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { compileFunnelStarterDesign, buildFunnelStarterDesignJson } from "@/lib/lms/funnelStarterDesign";
import {
  buildCheckoutDesignJson,
  buildOrderConfirmationDesignJson,
  buildStorefrontDesignJson,
  buildTrackOrderDesignJson,
  ensureOrderConfirmationPage,
  ensureStorefrontLayout,
  renameStorefrontSlug,
} from "@/lib/commerce/storefrontLayout";
import { PRODUCT_DETAIL_STARTER_DESIGN_JSON, ensureProductDetailLayout, hasProductDetailMarker } from "@/lib/commerce/productDetailLayout";
import { BLOG_MARKER_NAMES, hasBlogMarker, substituteBlogMarkers } from "@/lib/pub/blogLayoutRender";
import { compileTemplate } from "@/lib/compileTemplate";
import { parseV2Design } from "@/lib/v2/design";
import { buildBlogListingLayoutV2, buildBlogPostLayoutV2, buildSiteFooterV2, buildSiteHeaderV2 } from "@/lib/v2/layoutDesigns";

const base = { userId: "u", organizationId: "o", kind: "LANDING_PAGE", sourceType: "BUILDER", compiledHtml: "" };
const v2Root = { ...base, id: "root", name: "Lineage Care", designFormat: "v2", designJson: {} };
const v1Root = { ...base, id: "root", name: "Lineage Care", designFormat: "v1", designJson: {} };

const children = () => [...h.templates.values()].filter((t) => t.id !== "root");
const bySlug = (slug: string) => children().find((t) => t.slug === slug)!;
const count = (html: string, needle: string) => html.split(needle).length - 1;
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
/** Ids are random in V1's builders; golden comparison ignores them. */
const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === "id" ? "ID" : x)));

beforeEach(() => {
  h.templates.clear();
  h.settings.clear();
  h.layout = null;
});

const MARKERS = { shop: "data-plexo-commerce-shopGrid", cart: "data-plexo-commerce-cartSummary", checkout: "data-plexo-commerce-checkoutFlow", confirm: "data-plexo-commerce-orderConfirmation", track: "data-plexo-commerce-orderTracking" };

describe("storefront auto-provisioning on a new-editor (v2) site", () => {
  it("creates the same four pages at the same slugs, as editable sections, with exactly the markers the server fills", async () => {
    h.templates.set("root", v2Root);
    await ensureStorefrontLayout("root", "o", "u");

    const store = bySlug("store");
    const checkout = bySlug("checkout");
    const confirmation = bySlug("order-confirmation");
    const track = bySlug("track-order");
    expect([store.parentId, checkout.parentId, confirmation.parentId, track.parentId]).toEqual(["root", store.id, "root", "root"]);
    expect([store.name, checkout.name, confirmation.name, track.name]).toEqual(["Shop", "Checkout", "Order Confirmation", "Track Order"]);
    for (const page of [store, checkout, confirmation, track]) {
      expect(page.designFormat).toBe("v2");
      expect(parseV2Design(page.designJson).ok).toBe(true);
    }
    // Managed sections an owner edits as plain words: header, one store section, footer.
    const kinds = (p: any) => p.designJson.pages[0].rootNode.children.map((s: any) => s.props?.block?.kind);
    expect(kinds(store)).toEqual(["header", "shop", "footer"]);
    expect(kinds(checkout)).toEqual(["header", "cartCheckout", "footer"]);
    expect(kinds(confirmation)).toEqual(["header", "orderConfirmation", "footer"]);
    expect(kinds(track)).toEqual(["header", "orderTracking", "footer"]);

    expect(count(store.compiledHtml, MARKERS.shop)).toBe(1);
    expect(count(checkout.compiledHtml, MARKERS.cart)).toBe(1);
    expect(count(checkout.compiledHtml, MARKERS.checkout)).toBe(1);
    expect(count(confirmation.compiledHtml, MARKERS.confirm)).toBe(1);
    expect(count(track.compiledHtml, MARKERS.track)).toBe(1);
    // Nothing from another page's marker set leaks in.
    expect(count(store.compiledHtml, MARKERS.checkout)).toBe(0);

    const s = h.settings.get("root")!;
    expect(s).toMatchObject({ storefrontTemplateId: store.id, storefrontCheckoutTemplateId: checkout.id, orderConfirmationTemplateId: confirmation.id, trackOrderTemplateId: track.id });
  });

  it("every link between the store pages resolves to a page that exists", async () => {
    h.templates.set("root", v2Root);
    await ensureStorefrontLayout("root", "o", "u");
    const served = new Set(["/", "/store", "/store/checkout", "/order-confirmation", "/track-order"]);
    for (const slug of ["store", "checkout", "order-confirmation", "track-order"]) {
      const links = hrefs(bySlug(slug).compiledHtml).filter((x) => x.startsWith("/") && !x.startsWith("//"));
      expect(links.length).toBeGreaterThan(0);
      for (const l of links) expect(served.has(l), `${slug} links to ${l}`).toBe(true);
    }
    expect(hrefs(bySlug("order-confirmation").compiledHtml)).toContain("/store"); // "Keep shopping"
  });

  it("is idempotent", async () => {
    h.templates.set("root", v2Root);
    await ensureStorefrontLayout("root", "o", "u");
    const before = children().map((t) => t.id).sort();
    const settings = { ...h.settings.get("root")! };
    await ensureStorefrontLayout("root", "o", "u");
    expect(children().map((t) => t.id).sort()).toEqual(before);
    expect(h.settings.get("root")).toMatchObject({ storefrontTemplateId: settings.storefrontTemplateId, trackOrderTemplateId: settings.trackOrderTemplateId });
  });

  it("adopts a page the owner already has at /store instead of replacing it (whatever its format)", async () => {
    h.templates.set("root", v2Root);
    h.templates.set("mine", { ...base, id: "mine", name: "Our shop", parentId: "root", slug: "store", designFormat: "v1", designJson: { body: { rows: [] } } });
    await ensureStorefrontLayout("root", "o", "u");
    expect(h.settings.get("root")!.storefrontTemplateId).toBe("mine");
    expect(children().filter((t) => t.slug === "store")).toHaveLength(1);
  });

  it("does not add a second header/footer when the site already has a shared one", async () => {
    h.templates.set("root", v2Root);
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designFormat: "v2", designJson: buildSiteHeaderV2("SHARED-HEADER") });
    h.templates.set("ftr", { ...base, id: "ftr", name: "Footer", isSiteLayoutFragment: true, designFormat: "v2", designJson: buildSiteFooterV2("SHARED-FOOTER") });
    h.layout = { templateId: "root", enabled: true, headerTemplateId: "hdr", footerTemplateId: "ftr" };
    await ensureStorefrontLayout("root", "o", "u");
    const store = bySlug("store");
    expect(store.designJson.pages[0].rootNode.children.map((s: any) => s.props?.block?.kind)).toEqual(["shop"]);
    expect(count(store.compiledHtml, "SHARED-HEADER")).toBe(1);
    expect(store.compiledHtml).toContain("SHARED-FOOTER");
    expect(store.compiledHtml).not.toContain("Lineage Care"); // no second, page-own brand bar
  });

  it("renaming the shop moves the generated links with it (v2) and recompiles", async () => {
    h.templates.set("root", v2Root);
    await ensureStorefrontLayout("root", "o", "u");
    await ensureProductDetailLayout("root", "o", "u");
    await renameStorefrontSlug("root", "shop");
    for (const slug of ["order-confirmation", "track-order"]) {
      const page = bySlug(slug);
      expect(JSON.stringify(page.designJson)).not.toContain('"/store"');
      expect(hrefs(page.compiledHtml)).toContain("/shop");
      expect(hrefs(page.compiledHtml)).not.toContain("/store");
    }
    const detail = h.templates.get(h.settings.get("root")!.productDetailTemplateId)!;
    expect(hrefs(detail.compiledHtml)).toContain("/shop");
  });
});

describe("storefront on a classic (v1) site is unchanged", () => {
  it("creates the classic pages: no designFormat written, same designs, same compile (golden)", async () => {
    h.templates.set("root", v1Root);
    await ensureStorefrontLayout("root", "o", "u");
    const row = (type: string, minHeight: string) => ({ id: "ID", style: { padding: "16px 24px 48px" }, columns: [{ id: "ID", width: "100%", styles: {}, elements: [{ id: "ID", type, style: { width: "100%", minHeight }, attributes: {} }] }] });
    const heading = (text: string) => ({ id: "ID", style: { padding: "48px 24px 8px" }, columns: [{ id: "ID", width: "100%", styles: {}, elements: [{ id: "ID", type: "heading", style: { fontSize: "32px", fontWeight: "800", textAlign: "center" }, attributes: { text } }] }] });
    const doc = (...rows: unknown[]) => ({ body: { style: { background: "#ffffff", fontFamily: "inherit" }, rows } });
    expect(norm(bySlug("store").designJson)).toEqual(doc(heading("Shop"), row("shop_grid", "700px")));
    expect(norm(bySlug("checkout").designJson)).toEqual(doc(heading("Your Cart"), row("cart_summary", "300px"), row("checkout_flow", "500px")));
    expect(norm(bySlug("order-confirmation").designJson)).toEqual(doc(row("order_confirmation", "500px")));
    expect(norm(bySlug("track-order").designJson)).toEqual(doc(heading("Track Your Order"), row("order_tracking", "400px")));
    for (const slug of ["store", "checkout", "order-confirmation", "track-order"]) {
      const page = bySlug(slug);
      expect("designFormat" in page && page.designFormat !== "v1").toBe(false);
      expect(page.compiledHtml).toBe(sanitizeHtml(compileToHTML(page.designJson)));
    }
    // the exported builders are still the classic ones
    expect(norm(buildStorefrontDesignJson())).toEqual(norm(bySlug("store").designJson));
    expect(norm(buildCheckoutDesignJson())).toEqual(norm(bySlug("checkout").designJson));
    expect(norm(buildOrderConfirmationDesignJson())).toEqual(norm(bySlug("order-confirmation").designJson));
    expect(norm(buildTrackOrderDesignJson())).toEqual(norm(bySlug("track-order").designJson));
  });

  it("renaming the shop leaves classic pages alone", async () => {
    h.templates.set("root", v1Root);
    await ensureStorefrontLayout("root", "o", "u");
    const before = JSON.stringify(bySlug("order-confirmation").designJson);
    await renameStorefrontSlug("root", "shop");
    expect(JSON.stringify(bySlug("order-confirmation").designJson)).toBe(before);
  });
});

describe("donations-only order confirmation page", () => {
  it("v2: 'Keep shopping' goes home when there is no shop, and it is idempotent", async () => {
    h.templates.set("root", v2Root);
    await ensureOrderConfirmationPage("root", "o", "u");
    const page = bySlug("order-confirmation");
    expect(page.designFormat).toBe("v2");
    expect(count(page.compiledHtml, MARKERS.confirm)).toBe(1);
    expect(hrefs(page.compiledHtml)).not.toContain("/store");
    await ensureOrderConfirmationPage("root", "o", "u");
    expect(children()).toHaveLength(1);
  });
});

describe("product detail layout", () => {
  it("v2: one editable product section whose compiled output is recognised as ready", async () => {
    h.templates.set("root", v2Root);
    const id = await ensureProductDetailLayout("root", "o", "u");
    const row = h.templates.get(id)!;
    expect(row.designFormat).toBe("v2");
    expect(row.isCommerceLayout).toBe(true);
    expect(parseV2Design(row.designJson).ok).toBe(true);
    expect(hasProductDetailMarker(row.compiledHtml)).toBe(true);
    expect(count(row.compiledHtml, 'data-plexo-commerce-mode="detail"')).toBe(1);
    expect(hrefs(row.compiledHtml)).toContain("/store"); // "Back to the shop"
    h.settings.set("root", { templateId: "root", productDetailTemplateId: id });
    expect(await ensureProductDetailLayout("root", "o", "u")).toBe(id); // idempotent
    expect([...h.templates.values()].filter((t) => t.isCommerceLayout)).toHaveLength(1);
  });

  it("v1: the classic starter, byte-for-byte", async () => {
    h.templates.set("root", v1Root);
    const id = await ensureProductDetailLayout("root", "o", "u");
    const row = h.templates.get(id)!;
    expect(row.designJson).toEqual(PRODUCT_DETAIL_STARTER_DESIGN_JSON);
    expect(row.compiledHtml).toBe(sanitizeHtml(compileToHTML(PRODUCT_DETAIL_STARTER_DESIGN_JSON)));
    expect(hasProductDetailMarker(row.compiledHtml)).toBe(true);
    expect(row.designFormat).toBe("v1");
  });
});

describe("funnel starter", () => {
  it("v2: a Sign-up section whose form marker carries the funnel's id", async () => {
    h.templates.set("root", v2Root);
    const out = await compileFunnelStarterDesign("Free <b>Course</b>", "root");
    expect(out.designFormat).toBe("v2");
    expect(parseV2Design(out.designJson).ok).toBe(true);
    expect(count(out.compiledHtml, "data-plexo-lms-signup")).toBe(1);
    expect(out.compiledHtml).toContain('data-plexo-template-id="root"');
    expect(out.compiledHtml).toContain("Free &lt;b&gt;Course&lt;/b&gt;"); // escaped, never markup
    expect(out.compiledHtml).not.toContain("<b>Course</b>");
  });

  it("v1: unchanged", async () => {
    h.templates.set("root", v1Root);
    const out = await compileFunnelStarterDesign("My Funnel", "root");
    expect(out.designFormat).toBe("v1");
    expect(out.designJson).toEqual(buildFunnelStarterDesignJson("My Funnel", "root"));
    expect(out.compiledHtml).toBe(sanitizeHtml(compileToHTML(out.designJson)));
    expect(count(out.compiledHtml, "data-plexo-lms-signup")).toBe(1);
  });
});

describe("blog layouts and shared header/footer on v2", () => {
  const chrome = { siteName: "Lineage Care", header: true, footer: true };
  const compile = (design: unknown) => compileTemplate({ id: "L", name: "L", kind: "LANDING_PAGE", designFormat: "v2", designJson: design }, { rootTemplateId: "root" });

  it("post layout: ready (content marker) and the server's real substitution fills the marker slots", async () => {
    const design = buildBlogPostLayoutV2(chrome);
    expect(parseV2Design(design).ok).toBe(true);
    const html = await compile(design);
    expect(hasBlogMarker(html, "content")).toBe(true);
    for (const name of ["title", "content", "featuredImage", "date", "author", "categories", "comments"] as const) expect(count(html.toLowerCase(), `data-plexo-blog-${name.toLowerCase()}="true"`), name).toBe(1);
    const out = substituteBlogMarkers(html, { content: "<p>REAL-POST-BODY</p>", title: "REAL-TITLE" });
    expect(out).toContain("REAL-POST-BODY");
    expect(out).toContain("REAL-TITLE");
    expect(out).not.toContain('data-plexo-blog-content="true"></div>');
  });

  it("listing layout: ready (postList marker) and substitution works", async () => {
    const design = buildBlogListingLayoutV2(chrome);
    const html = await compile(design);
    expect(hasBlogMarker(html, "postList")).toBe(true);
    expect(count(html.toLowerCase(), 'data-plexo-blog-postlist="true"')).toBe(1);
    expect(substituteBlogMarkers(html, { postList: "<ul>REAL-LIST</ul>" })).toContain("REAL-LIST");
    expect(BLOG_MARKER_NAMES).toContain("postList");
  });

  it("default header and footer fragments are valid, link only to real places, and omit the shop link when there is none", async () => {
    for (const [design, shop] of [[buildSiteHeaderV2("Lineage Care", null), null], [buildSiteHeaderV2("Lineage Care", "/store"), "/store"], [buildSiteFooterV2("Lineage Care", null), null], [buildSiteFooterV2("Lineage Care", "/store"), "/store"]] as const) {
      expect(parseV2Design(design).ok).toBe(true);
      const html = await compile(design);
      expect(html).toContain("Lineage Care");
      const links = hrefs(html);
      expect(links).toContain("/");
      expect(links.includes("/store")).toBe(shop === "/store");
    }
  });
});
