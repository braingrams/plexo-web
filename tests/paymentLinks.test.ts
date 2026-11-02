import { describe, expect, it } from "vitest";
import { buyHref, findPaymentLinksInHtml, isPaymentLink, pickLinksToConvert, rewriteClassicPaymentLinks, rewritePaymentLinksInHtml, sectionLinkPatch } from "@/lib/commerce/paymentLinks";

describe("what counts as a payment link", () => {
  it("recognises hosted checkout pages", () => {
    for (const url of [
      "https://flutterwave.com/pay/aivideocreationcourse",
      "https://paystack.com/pay/my-course",
      "https://paystack.shop/pay/abc",
      "https://selar.co/my-course",
      "https://buy.stripe.com/test_123",
      "https://checkout.stripe.com/c/pay/cs_1",
      "https://mystore.gumroad.com/l/course",
      "https://payhip.com/b/AbC12",
    ]) expect(isPaymentLink(url), url).toBe(true);
  });

  it("never touches donation, social or ordinary links", () => {
    for (const url of ["https://paypal.me/someone", "https://ko-fi.com/someone", "https://twitter.com/x", "https://flutterwave.com/about", "https://stripe.com/docs", "/pricing", "#buy", "", null, 5]) expect(isPaymentLink(url as never), String(url)).toBe(false);
  });
});

describe("which links belong to the product", () => {
  it("takes the page's one payment link, however many buttons use it", () => {
    expect(pickLinksToConvert(["https://flutterwave.com/pay/a", "https://flutterwave.com/pay/a"])).toEqual({ urls: ["https://flutterwave.com/pay/a"], unclear: [] });
  });
  it("won't guess between different ones, unless told which", () => {
    const two = ["https://flutterwave.com/pay/a", "https://selar.co/b"];
    expect(pickLinksToConvert(two)).toEqual({ urls: [], unclear: two });
    expect(pickLinksToConvert(two, "SELAR.co")).toEqual({ urls: ["https://selar.co/b"], unclear: [] });
  });
});

describe("rewriting a hand-written page", () => {
  const html = `<a href="https://selar.co/x" target="_blank" rel="noopener" class="b">Buy</a> <a href='https://selar.co/x'>Again</a> <a href="https://selar.co/other">Other</a><script>"<a href='https://selar.co/x'>"</script>`;
  it("changes only the chosen anchors and keeps their look", () => {
    expect(findPaymentLinksInHtml(html)).toEqual(["https://selar.co/x", "https://selar.co/x", "https://selar.co/other"]);
    const out = rewritePaymentLinksInHtml(html, "p 1", ["https://selar.co/x"]);
    expect(out.count).toBe(2);
    expect(out.html).toContain('<a href="#plexo-buy-p%201" class="b">Buy</a>');
    expect(out.html).toContain(`<a href="#plexo-buy-p%201">Again</a>`);
    expect(out.html).toContain('<a href="https://selar.co/other">Other</a>');
    expect(out.html).toContain(`<script>"<a href='https://selar.co/x'>"</script>`);
  });
  it("does nothing when asked to change nothing", () => {
    expect(rewritePaymentLinksInHtml(html, "p", []).html).toBe(html);
  });
  it("has one link format for every editor", () => {
    expect(buyHref("abc")).toBe("#plexo-buy-abc");
  });
});

describe("rewriting a classic design and a ready-made section", () => {
  it("changes only matching hrefs, anywhere in the tree", () => {
    const design = { body: { rows: [{ columns: [{ elements: [{ type: "button", attributes: { href: "https://selar.co/x" } }, { type: "button", attributes: { href: "/pricing" } }] }] }] } };
    const out = rewriteClassicPaymentLinks(design, "p", ["https://selar.co/x"]);
    expect(out.count).toBe(1);
    expect(JSON.stringify(out.design)).toContain("#plexo-buy-p");
    expect(JSON.stringify(out.design)).toContain("/pricing");
    expect(JSON.stringify(design)).toContain("https://selar.co/x"); // the original is not mutated
  });

  it("sends a section's changed fields whole, with only the link replaced", () => {
    const content = { headline: "Hi", cta: { label: "Go", href: "https://selar.co/x" }, plans: [{ name: "A", cta: { label: "Buy A", href: "https://selar.co/x" } }, { name: "B", cta: { label: "Buy B", href: "/contact" } }] };
    const patch = sectionLinkPatch([{ path: "cta.href", content }, { path: "plans.0.cta.href", content }], "#plexo-buy-p");
    expect(patch).toEqual({
      cta: { label: "Go", href: "#plexo-buy-p" },
      plans: [{ name: "A", cta: { label: "Buy A", href: "#plexo-buy-p" } }, { name: "B", cta: { label: "Buy B", href: "/contact" } }],
    });
    expect(content.cta.href).toBe("https://selar.co/x");
  });
});
