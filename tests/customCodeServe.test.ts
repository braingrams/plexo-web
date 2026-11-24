import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { row: null as Record<string, unknown> | null };
vi.mock("@/lib/db/contentEntities", () => ({
  SiteLayout: { get: () => ({ go: async () => ({ data: state.row }) }) },
}));

import { applyOwnerCode, isEmbeddedRequest, isPaymentPage } from "@/lib/customCode/serve";
import { injectCustomCode, OWNER_FOOTER_MARK, OWNER_HEAD_MARK } from "@/lib/pub/htmlInject";

const PAGE = "<!doctype html><html><head><title>t</title></head><body><h1>Hi</h1></body></html>";
const HEAD = '<meta name="google-site-verification" content="abc">';
const FOOT = '<script src="https://static.hotjar.com/c/hotjar-1.js"></script>';
const site = { templateId: "t", type: "CUSTOM", plan: "STARTER" } as const;
const count = (s: string, needle: string) => s.split(needle).length - 1;

beforeEach(() => {
  state.row = { customHeadCode: HEAD, customFooterCode: FOOT };
});

describe("injection placement", () => {
  it("puts header code at the end of <head> and footer code at the end of <body>, once each", () => {
    const out = injectCustomCode(PAGE, { head: HEAD, footer: FOOT });
    expect(out.indexOf(HEAD)).toBeGreaterThan(out.indexOf("<title>"));
    expect(out.indexOf(HEAD)).toBeLessThan(out.indexOf("</head>"));
    expect(out.indexOf(FOOT)).toBeGreaterThan(out.indexOf("<h1>"));
    expect(out.indexOf(FOOT)).toBeLessThan(out.indexOf("</body>"));
    expect(count(out, HEAD)).toBe(1);
    expect(count(out, FOOT)).toBe(1);
  });
  it("is once-only even when applied twice", () => {
    const once = injectCustomCode(PAGE, { head: HEAD, footer: FOOT });
    const twice = injectCustomCode(once, { head: HEAD, footer: FOOT });
    expect(twice).toBe(once);
    expect(count(twice, OWNER_HEAD_MARK)).toBe(1);
    expect(count(twice, OWNER_FOOTER_MARK)).toBe(1);
  });
  it("is not fooled by a fake </head> or </body> inside a script", () => {
    const page = '<html><head><script>var a="</head>"</script></head><body><script>var b="</body>"</script></body></html>';
    const out = injectCustomCode(page, { head: HEAD, footer: FOOT });
    expect(out).toContain('var a="</head>"</script>' + OWNER_HEAD_MARK + HEAD + "</head>");
    expect(out.endsWith(OWNER_FOOTER_MARK + FOOT + "</body></html>")).toBe(true);
  });
  it("never lands in front of the doctype when the page has no <head>", () => {
    const out = injectCustomCode("<!doctype html><p>hi</p>", { head: HEAD });
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain(HEAD);
    const withHtml = injectCustomCode("<!DOCTYPE html><html lang=en><p>hi</p></html>", { head: HEAD });
    expect(withHtml.indexOf(HEAD)).toBeGreaterThan(withHtml.indexOf("<html"));
  });
  it("leaves the page byte-for-byte alone with no code", () => {
    expect(injectCustomCode(PAGE, {})).toBe(PAGE);
    expect(injectCustomCode(PAGE, { head: "", footer: null })).toBe(PAGE);
  });
  it("adds footer code at the end when there is no </body>", () => {
    expect(injectCustomCode("<p>x</p>", { footer: FOOT })).toBe("<p>x</p>" + OWNER_FOOTER_MARK + FOOT);
  });
});

describe("when it runs", () => {
  it("runs on the owner's custom domain for Starter, Pro and Enterprise", async () => {
    for (const plan of ["STARTER", "PRO", "ENTERPRISE"]) {
      const out = await applyOwnerCode(PAGE, { ...site, plan });
      expect(out).toContain(HEAD);
      expect(out).toContain(FOOT);
    }
  });
  it("does not run on the shared Plexo address, or on Free", async () => {
    expect(await applyOwnerCode(PAGE, { ...site, type: "SUBDOMAIN" })).toBe(PAGE);
    expect(await applyOwnerCode(PAGE, { ...site, plan: "FREE" })).toBe(PAGE);
    expect(await applyOwnerCode(PAGE, { ...site, plan: null })).toBe(PAGE);
  });
  it("does not run when the page is shown inside another page", async () => {
    for (const dest of ["iframe", "frame", "embed", "object", "IFRAME"]) expect(await applyOwnerCode(PAGE, { ...site, secFetchDest: dest })).toBe(PAGE);
    expect(await applyOwnerCode(PAGE, { ...site, secFetchDest: "document" })).toContain(HEAD);
    expect(await applyOwnerCode(PAGE, { ...site, secFetchDest: null })).toContain(HEAD);
    expect(isEmbeddedRequest("iframe")).toBe(true);
    expect(isEmbeddedRequest("document")).toBe(false);
  });
  const checkout = PAGE.replace("<h1>Hi</h1>", '<div data-plexo-commerce-checkoutFlow="true"></div>');
  it("skips cart, checkout, order and donation pages unless the owner opted in", async () => {
    for (const marker of ['data-plexo-commerce-checkoutFlow="true"', "data-plexo-commerce-cartSummary", "data-plexo-commerce-orderConfirmation", "data-plexo-commerce-orderTracking", "data-plexo-donation"]) {
      const page = PAGE.replace("<h1>Hi</h1>", `<div ${marker}></div>`);
      expect(isPaymentPage(page)).toBe(true);
      expect(await applyOwnerCode(page, site)).toBe(page);
    }
    expect(await applyOwnerCode(checkout, site)).toBe(checkout);
    state.row = { ...state.row, customCodeOnCheckout: true };
    expect(await applyOwnerCode(checkout, site)).toContain(HEAD);
  });
  it("still runs on a page that merely sells something", async () => {
    const buy = PAGE.replace("<h1>Hi</h1>", '<button data-plexo-buy data-plexo-product-id="p1">Buy</button>');
    expect(isPaymentPage(buy)).toBe(false);
    expect(await applyOwnerCode(buy, site)).toContain(HEAD);
  });
  it("re-checks saved code at serve time and drops anything that is no longer acceptable", async () => {
    state.row = { customHeadCode: "<div onclick=x()>bad</div>", customFooterCode: FOOT };
    const out = await applyOwnerCode(PAGE, site);
    expect(out).not.toContain("onclick");
    expect(out).toContain(FOOT);
  });
  it("does nothing when nothing was saved, and never breaks the page on an error", async () => {
    state.row = null;
    expect(await applyOwnerCode(PAGE, site)).toBe(PAGE);
    state.row = { customHeadCode: "" };
    expect(await applyOwnerCode(PAGE, site)).toBe(PAGE);
  });
});

describe("code for one page", () => {
  const PAGE_HEAD = '<meta name="facebook-domain-verification" content="zzz">';
  it("adds the page's own code after the site-wide code, on that page only", async () => {
    const out = await applyOwnerCode(PAGE, site, { head: PAGE_HEAD, footer: null });
    expect(out.indexOf(PAGE_HEAD)).toBeGreaterThan(out.indexOf(HEAD));
    expect(count(out, PAGE_HEAD)).toBe(1);
    expect(await applyOwnerCode(PAGE, site, undefined)).not.toContain(PAGE_HEAD);
  });
  it("works with no site-wide code at all", async () => {
    state.row = null;
    expect(await applyOwnerCode(PAGE, site, { head: PAGE_HEAD })).toContain(PAGE_HEAD);
  });
  it("still stays off payment pages and the free address", async () => {
    state.row = null;
    const pay = PAGE.replace("<h1>Hi</h1>", '<div data-plexo-commerce-checkoutflow></div>');
    expect(await applyOwnerCode(pay, site, { head: PAGE_HEAD })).not.toContain(PAGE_HEAD);
    expect(await applyOwnerCode(PAGE, { ...site, type: "SUBDOMAIN" }, { head: PAGE_HEAD })).not.toContain(PAGE_HEAD);
  });
  it("re-checks the saved page code when serving, so unsafe code never goes out", async () => {
    state.row = null;
    expect(await applyOwnerCode(PAGE, site, { head: '<meta http-equiv="refresh" content="0;url=https://evil.example">' })).not.toContain("evil.example");
  });
});
