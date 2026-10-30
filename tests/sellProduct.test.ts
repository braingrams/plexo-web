import { describe, expect, it, vi } from "vitest";
import { blankV2Design } from "@/lib/v2/design";
import { applyToDesign } from "@/lib/mcp/v2Pages";
import { hasProductMarker, insertBeforeFooter, productJsx, productMarker, productSection } from "@/lib/commerce/embedSnippets";
import { orderLinkOnHomepage, orderReturnUrl, safeReturnPath } from "@/lib/commerce/returnPath";

vi.mock("@/server/authDynamo", () => ({ auth: vi.fn(), dynamoAdapter: {} }));
vi.mock("@/lib/db/client", () => ({ TABLES: { content: "content", commerce: "commerce", ops: "ops", import: "import" }, docClient: { send: vi.fn(async () => ({})) } }));

const ID = "721cda0c-48ef-4542-8fe4-7c367b0688f9";

describe("product markup", () => {
  it("is one buy-now card marker, with an optional button label", () => {
    expect(productMarker(ID)).toBe(`<div data-plexo-commerce-product data-plexo-product-id="${ID}" data-plexo-commerce-mode="buy"></div>`);
    expect(productMarker(ID, { buttonLabel: 'Enrol "now"' })).toContain('data-plexo-commerce-button-label="Enrol &quot;now&quot;"');
    expect(productMarker(ID, { buttonLabel: "Buy now" })).not.toContain("button-label");
  });

  it("has a JSX twin for React apps", () => {
    expect(productJsx(ID)).toBe(`<div data-plexo-commerce-product data-plexo-product-id="${ID}" data-plexo-commerce-mode="buy" />`);
  });

  it("recognises a page that already sells the product", () => {
    expect(hasProductMarker(`<main>${productSection(ID)}</main>`, ID)).toBe(true);
    expect(hasProductMarker("<main></main>", ID)).toBe(false);
    expect(hasProductMarker(productMarker("another-id"), ID)).toBe(false);
  });
});

describe("placing it in a hand-written page", () => {
  const card = "<section>CARD</section>";
  it("goes above the footer", () => {
    expect(insertBeforeFooter("<body><main>Hi</main><footer>Bye</footer></body>", card)).toBe("<body><main>Hi</main><section>CARD</section>\n<footer>Bye</footer></body>");
  });
  it("goes before </body> when there is no footer", () => {
    expect(insertBeforeFooter("<body><main>Hi</main></body>", card)).toBe("<body><main>Hi</main><section>CARD</section>\n</body>");
  });
  it("is not fooled by a footer or </body> inside a script", () => {
    const html = `<body><script>var s="<footer>"; var b="</body>";</script><main>Hi</main></body>`;
    const out = insertBeforeFooter(html, card);
    expect(out.endsWith(`<main>Hi</main><section>CARD</section>\n</body>`)).toBe(true);
    expect(out.startsWith(`<body><script>var s="<footer>"; var b="</body>";</script>`)).toBe(true);
  });
  it("appends when there is no body at all", () => {
    expect(insertBeforeFooter("<p>Hi</p>", card)).toBe("<p>Hi</p>\n<section>CARD</section>\n");
  });
});

describe("where a buyer returns to", () => {
  it("only honours a path on the same site", () => {
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/course?x=1#top")).toBe("/course");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", "course", 42, null, "/a\nb"]) expect(safeReturnPath(bad)).toBeNull();
  });

  it("brings the buyer back to their own page when given one, else to the confirmation page", () => {
    expect(orderReturnUrl("https://x.test", "ORD-1", "a+b@c.com", "/")).toBe("https://x.test/?plexo_order=ORD-1&email=a%2Bb%40c.com");
    expect(orderReturnUrl("https://x.test", "ORD-1", "a@c.com", null)).toBe("https://x.test/order-confirmation?order=ORD-1&email=a%40c.com");
  });

  it("maps an old confirmation link onto the homepage for a one-page site", () => {
    expect(orderLinkOnHomepage("/order-confirmation", "?order=ORD-1&email=a%40c.com")).toBe("/?plexo_order=ORD-1&email=a%40c.com");
    expect(orderLinkOnHomepage("/order-confirmation/", "?order=ORD-1&email=a%40c.com")).not.toBeNull();
    expect(orderLinkOnHomepage("/order-confirmation", "?order=ORD-1")).toBeNull();
    expect(orderLinkOnHomepage("/about", "?order=ORD-1&email=a%40c.com")).toBeNull();
  });
});

describe("the visual editor's Sell a product section", () => {
  it("is added with the product, before the footer, as a buy-now card", () => {
    const design = blankV2Design();
    const withFooter = applyToDesign(design, [{ op: "addSection", kind: "footer" }]).design;
    const out = applyToDesign(withFooter, [{ op: "addSection", kind: "productOffer", variant: "centered", content: { heading: "AI Video Course", text: "", productId: ID } }]);
    expect(out.reports.every((r) => r.ok)).toBe(true);
    const json = JSON.stringify(out.design.pages[0].rootNode);
    expect(json).toContain(ID);
    expect(json).toContain('"mode":"buy"');
    const kids = out.design.pages[0].rootNode.children ?? [];
    expect(JSON.stringify(kids[kids.length - 1])).toContain("footer"); // the offer sits above the footer
  });

  it("rejects a product that isn't text", () => {
    const out = applyToDesign(blankV2Design(), [{ op: "addSection", kind: "productOffer", content: { productId: 123 } }]);
    expect(out.reports[0].ok).toBe(false);
  });
});
