import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const serving = vi.fn();
vi.mock("@/lib/brand/siteBrand", () => ({ brandForServing: (...a: unknown[]) => serving(...a) }));
vi.mock("@/lib/projects/blobStore", () => ({ getObject: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/pub/deployedAppRateLimit", () => ({ checkDeployedAppDailyLimit: vi.fn().mockResolvedValue(true) }));

import { addBrandLinkToAppHtml, applyBrandToAppResponse, isBrandableResponse, MAX_HTML_BYTES } from "@/lib/brand/ssrInject";
import { serveDeployedSsr } from "@/lib/pub/serveDeployedSsr";

const TAG = '<link rel="stylesheet" href="/__plexo/brand/s1.css" data-plexo-brand>';
const PAGE = '<!doctype html><html><head><title>Hi</title><style>a{color:red}</style></head><body><h1>Hi</h1></body></html>';
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const HTML = { status: 200, contentType: "text/html; charset=utf-8", method: "GET" };

beforeEach(() => serving.mockReset().mockResolvedValue({ revision: "rev1", mapping: null, serverInject: true }));

describe("addBrandLinkToAppHtml (pure)", () => {
  it("puts the link at the end of <head>, once", () => {
    const out = addBrandLinkToAppHtml(PAGE, TAG);
    expect(out).toContain(`${TAG}</head>`);
    expect(addBrandLinkToAppHtml(out, TAG)).toBe(out);
  });
  it("ignores a </head> inside a script and still lands in the real head", () => {
    const html = '<html><head><script>document.write("</head>")</script></head><body></body></html>';
    const out = addBrandLinkToAppHtml(html, TAG);
    expect(out.indexOf(TAG)).toBeGreaterThan(out.indexOf("</script>"));
  });
  it("leaves a page that already links the sheet itself (the old opt-in) alone", () => {
    const own = PAGE.replace("</head>", '<link rel="stylesheet" href="/__plexo/brand/s1.css"></head>');
    expect(addBrandLinkToAppHtml(own, TAG)).toBe(own);
  });
  it("leaves a page that opts out alone", () => {
    for (const meta of ['<meta name="plexo-brand" content="off">', "<meta content='off' name='plexo-brand'>"]) {
      const page = PAGE.replace("<title>", `${meta}<title>`);
      expect(addBrandLinkToAppHtml(page, TAG)).toBe(page);
    }
  });
  it("leaves a page with its own meta CSP alone", () => {
    const page = PAGE.replace("<title>", `<meta http-equiv="Content-Security-Policy" content="style-src 'none'"><title>`);
    expect(addBrandLinkToAppHtml(page, TAG)).toBe(page);
  });
  it("leaves fragments (htmx partials) alone", () => {
    expect(addBrandLinkToAppHtml("<li>one</li><li>two</li>", TAG)).toBe("<li>one</li><li>two</li>");
  });
  it("handles a page with no </head> by going before <body>", () => {
    expect(addBrandLinkToAppHtml("<html><body>x</body></html>", TAG)).toBe(`<html>${TAG}<body>x</body></html>`);
  });
});

describe("isBrandableResponse", () => {
  it("accepts HTML pages incl. error pages, rejects everything else", () => {
    expect(isBrandableResponse({ status: 200, contentType: "text/html" })).toBe(true);
    expect(isBrandableResponse({ status: 404, contentType: "text/html; charset=utf-8" })).toBe(true);
    expect(isBrandableResponse({ status: 200, contentType: "application/json" })).toBe(false);
    expect(isBrandableResponse({ status: 200, contentType: "text/x-component" })).toBe(false);
    expect(isBrandableResponse({ status: 200, contentType: null })).toBe(false);
    expect(isBrandableResponse({ status: 302, contentType: "text/html" })).toBe(false);
    expect(isBrandableResponse({ status: 204, contentType: "text/html" })).toBe(false);
    expect(isBrandableResponse({ status: 200, contentType: "text/html", method: "HEAD" })).toBe(false);
    expect(isBrandableResponse({ status: 200, contentType: "text/html", byteLength: MAX_HTML_BYTES + 1 })).toBe(false);
    expect(isBrandableResponse({ status: 200, contentType: "text/html", byteLength: 0 })).toBe(false);
  });
});

describe("applyBrandToAppResponse", () => {
  it("adds the link at a stable address for a linked site with the switch on", async () => {
    const out = dec(await applyBrandToAppResponse(enc(PAGE), "s1", HTML));
    expect(out).toContain('href="/__plexo/brand/s1.css" data-plexo-brand');
    expect(out).not.toContain("?v=");
  });
  it("is idempotent", async () => {
    const once = await applyBrandToAppResponse(enc(PAGE), "s1", HTML);
    const twice = await applyBrandToAppResponse(once, "s1", HTML);
    expect(dec(twice).split("data-plexo-brand").length).toBe(2);
  });
  it("returns the very same bytes for non-HTML", async () => {
    const json = enc('{"a":"<head></head>"}');
    expect(await applyBrandToAppResponse(json, "s1", { ...HTML, contentType: "application/json" })).toBe(json);
    expect(serving).not.toHaveBeenCalled();
  });
  it("is untouched when the site has no brand, or the switch is off", async () => {
    const body = enc(PAGE);
    serving.mockResolvedValueOnce(null);
    expect(await applyBrandToAppResponse(body, "s1", HTML)).toBe(body);
    serving.mockResolvedValueOnce({ revision: "r", mapping: null, serverInject: false });
    expect(await applyBrandToAppResponse(body, "s1", HTML)).toBe(body);
  });
  it("an existing linked site (no new flag) and the kill switch both return the same bytes", async () => {
    const body = enc(PAGE);
    serving.mockResolvedValueOnce({ revision: "r", mapping: { colors: {}, fonts: {} }, serverInject: false });
    expect(await applyBrandToAppResponse(body, "s1", HTML)).toBe(body);
    process.env.BRAND_SERVER_INJECT = "off";
    try {
      expect(await applyBrandToAppResponse(body, "s1", HTML)).toBe(body);
      expect(serving).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.BRAND_SERVER_INJECT;
    }
  });
  it("fails open: a lookup that throws, or bytes that aren't UTF-8, serve the page as it was", async () => {
    const body = enc(PAGE);
    serving.mockRejectedValueOnce(new Error("db down"));
    expect(await applyBrandToAppResponse(body, "s1", HTML)).toBe(body);
    const latin1 = new Uint8Array([...enc("<html><head></head><body>"), 0xe9, ...enc("</body></html>")]);
    expect(await applyBrandToAppResponse(latin1, "s1", HTML)).toBe(latin1);
  });
  it("keeps non-ASCII text intact", async () => {
    const out = dec(await applyBrandToAppResponse(enc(PAGE.replace("Hi</h1>", "Ọ̀nà 你好</h1>")), "s1", HTML));
    expect(out).toContain("Ọ̀nà 你好");
  });
});

describe("through the serve layer", () => {
  // A site WITHOUT the new flag must get exactly the bytes and headers the app produced.
  const cases: Array<[string, string, Record<string, string>, number]> = [
    ["a full page with a head", PAGE, { "content-type": "text/html; charset=utf-8", etag: '"e"', "cache-control": "no-store" }, 200],
    ["a page with no head", "<html><body>x</body></html>", { "content-type": "text/html" }, 200],
    ["a streamed-looking chunked page", PAGE.repeat(50), { "content-type": "text/html", "transfer-encoding": "chunked" }, 200],
    ["a page that already links the sheet", PAGE.replace("</head>", '<link rel="stylesheet" href="/__plexo/brand/s1.css"></head>'), { "content-type": "text/html" }, 200],
    ["JSON", '{"a":"<head></head>"}', { "content-type": "application/json" }, 200],
    ["an error page", PAGE, { "content-type": "text/html" }, 500],
    ["a not-found page", PAGE, { "content-type": "text/html" }, 404],
    ["a huge page", "<html><head></head><body>" + "x".repeat(MAX_HTML_BYTES + 10) + "</body></html>", { "content-type": "text/html" }, 200],
  ];
  for (const flagOff of ["no flag", "kill switch"]) {
    for (const [name, body, hdrs, status] of cases) {
      it(`${flagOff}: ${name} is relayed byte for byte, same headers`, async () => {
        if (flagOff === "no flag") serving.mockResolvedValue({ revision: "r", mapping: { colors: {}, fonts: {} }, serverInject: false });
        else {
          process.env.BRAND_SERVER_INJECT = "off";
          serving.mockResolvedValue({ revision: "r", mapping: null, serverInject: true });
        }
        try {
          vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status, headers: hdrs })));
          const res = await serveDeployedSsr(new NextRequest("https://site.test/p"), { functionUrl: "https://abc.lambda-url.us-east-1.on.aws/", ssrSitePrefix: "p", hostingTier: "LAMBDA" }, ["p"], { templateId: "s1", dailyRequestLimit: 100 });
          expect(await res.text()).toBe(body);
          expect(res.status).toBe(status);
          expect(res.headers.get("content-type")).toBe(hdrs["content-type"]);
          expect(res.headers.get("etag")).toBe(hdrs.etag ?? null);
        } finally {
          delete process.env.BRAND_SERVER_INJECT;
          vi.unstubAllGlobals();
        }
      });
    }
  }

  const app = { functionUrl: "https://abc.lambda-url.us-east-1.on.aws/", ssrSitePrefix: "p", hostingTier: "LAMBDA" };
  beforeEach(() => {
    process.env.AWS_ACCESS_KEY_ID = "AKIATESTONLY";
    process.env.AWS_SECRET_ACCESS_KEY = "testsecretonly";
  });
  afterEach(() => vi.unstubAllGlobals());
  const serve = (res: Response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    return serveDeployedSsr(new NextRequest("https://site.test/about"), app, ["about"], { templateId: "s1", dailyRequestLimit: 100 });
  };
  it("relays an app's HTML page with the brand link and no stale length header", async () => {
    const res = await serve(new Response(PAGE, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "content-length": String(PAGE.length) } }));
    const text = await res.text();
    expect(text).toContain("data-plexo-brand");
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.status).toBe(200);
  });
  it("relays JSON byte for byte", async () => {
    const res = await serve(new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }));
    expect(await res.text()).toBe('{"ok":true}');
  });
});
