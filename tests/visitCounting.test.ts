import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/db/contentEntities", () => ({ Template: {}, PublishedDomain: {} }));
vi.mock("@/lib/db/opsEntities", () => ({ PageView: {} }));
vi.mock("@/lib/analyticsRollup", () => ({ recordPageViewRollup: async () => undefined }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true }));
vi.mock("@/lib/pub/siteSitemap", () => ({ listSitePages: async () => [] }));
vi.mock("@/lib/appRuntime/http", () => ({ throttle: () => true }));

import { injectVisitBeacon, visitBeaconScript, PAGE_CACHE_CONTROL, VISIT_BEACON_PATH } from "@/lib/pub/visitBeacon";
import { mayRecognise } from "@/lib/pub/recordVisit";
import { pathsToClear } from "@/lib/pub/edgeCache";

const PAGE = "3f2b8d1e-1111-4222-8333-444455556666";

describe("visit beacon", () => {
  it("is added once, before the end of the page", () => {
    const once = injectVisitBeacon("<html><body><p>hi</p></body></html>", PAGE);
    expect(once).toContain(VISIT_BEACON_PATH);
    expect(once.indexOf("data-plexo-visit")).toBeLessThan(once.indexOf("</body>"));
    expect(injectVisitBeacon(once, PAGE)).toBe(once);
  });
  it("uses no cookies or browser storage, and sends nothing identifying", () => {
    const js = visitBeaconScript(PAGE);
    expect(js).not.toMatch(/cookie|localStorage|sessionStorage|indexedDB/i);
    expect(js).toContain("sendBeacon");
    expect(js).toContain("globalPrivacyControl");
  });
  it("cannot be broken out of by a hostile page id", () => {
    expect(visitBeaconScript('</script><script>alert(1)')).not.toContain("</script>");
  });
  it("leaves the Google tag alone", () => {
    expect(visitBeaconScript(PAGE)).not.toMatch(/gtag|googletagmanager|google-analytics/i);
  });
  it("pages are saved at the edge for a short time and refreshed in the background", () => {
    expect(PAGE_CACHE_CONTROL).toMatch(/s-maxage=\d+/);
    expect(PAGE_CACHE_CONTROL).toMatch(/stale-while-revalidate=\d+/);
    expect(PAGE_CACHE_CONTROL).toMatch(/max-age=0/);
  });
});

describe("who may be recognised", () => {
  const h = (country: string | null) => new Headers(country ? { "cloudfront-viewer-country": country } : {});
  it("is nobody where consent is needed, or when the browser asks not to be tracked", () => {
    expect(mayRecognise(h("DE"), false)).toBe(false);
    expect(mayRecognise(h(null), false)).toBe(false); // unknown means ask first
    expect(mayRecognise(h("US"), true)).toBe(false);
    expect(mayRecognise(h("US"), false)).toBe(true);
  });
});

describe("clearing saved page copies", () => {
  it("clears the home page and each page, with and without the trailing slash", () => {
    const paths = pathsToClear([{ loc: "https://a.plexopages.com/" }, { loc: "https://a.plexopages.com/about" }, { loc: "https://other.com/x" }], "a.plexopages.com");
    expect(paths).toEqual(expect.arrayContaining(["/", "/about", "/about/"]));
    expect(paths).not.toContain("/x");
  });
  it("falls back to one wildcard for a very big site", () => {
    const pages = Array.from({ length: 40 }, (_, i) => ({ loc: `https://a.plexopages.com/p${i}` }));
    expect(pathsToClear(pages, "a.plexopages.com")).toEqual(["/*"]);
  });
});

describe("the page route", () => {
  const route = readFileSync(new URL("../app/pub/[domain]/[[...slug]]/route.ts", import.meta.url), "utf8");
  it("no longer counts a visit when it renders (the beacon is the only counter, so nothing counts twice)", () => {
    expect(route).not.toMatch(/PageView\.create/);
    expect(route).toContain("injectVisitBeacon(html, cursor.id)");
  });
  it("sends the edge caching header on pages", () => {
    expect(route).toContain('"Cache-Control": PAGE_CACHE_CONTROL');
  });
});

describe("the edge setup", () => {
  const stack = readFileSync(new URL("../cdk/lib/published-sites-stack.ts", import.meta.url), "utf8");
  it("sends the beacon to the app uncached, with the location headers", () => {
    expect(stack).toMatch(/pathPattern: "__plexo\/v"[^}]*CACHING_DISABLED[^}]*visitBeaconOriginPolicy/);
  });
  it("no longer splits the page cache per city", () => {
    const policy = stack.slice(stack.indexOf("const pageCachePolicy"), stack.indexOf("const visitBeaconOriginPolicy"));
    expect(policy).not.toMatch(/allowList\([^)]*cloudfront-viewer-city/);
    expect(policy).toContain('"cloudfront-viewer-country"');
  });
});
