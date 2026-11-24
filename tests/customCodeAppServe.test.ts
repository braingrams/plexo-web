import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const state = { row: null as Record<string, unknown> | null, boom: false };
const extras = { speed: false, analytics: false };
vi.mock("@/lib/siteHealth/serve", () => ({
  healthSettingsFor: async () => ({}),
  serveCtxFor: async (_h: string, _v: unknown, base: unknown) => base,
  applyHealthSettings: (h: string) => (extras.speed ? h.replace("</head>", '<meta name="description" content="Speedy"></head>') : h),
}));
vi.mock("@/lib/googleAnalytics/serveTag", () => ({
  applyAnalyticsTag: async (h: string) => (extras.analytics ? h.replace("</head>", "<!--ga--></head>") : h),
}));
vi.mock("@/lib/db/contentEntities", () => ({
  SiteLayout: { get: () => ({ go: async () => { if (state.boom) throw new Error("db down"); return { data: state.row }; } }) },
}));

import { withAppPageExtras } from "@/lib/customCode/appServe";

const HEAD = '<meta name="facebook-domain-verification" content="abc">';
const FOOT = '<script src="https://static.hotjar.com/c/hotjar-1.js"></script>';
const APP = "<!doctype html><html><head><title>My app</title></head><body><div id=root></div></body></html>";
const site = { templateId: "t", type: "CUSTOM", plan: "STARTER", host: "app.example.com", path: "/", siteName: "My app", headers: new Headers() };
const html = (body: string, init: ResponseInit = {}) => new NextResponse(body, { ...init, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Length": String(body.length), ...(init.headers ?? {}) } });

beforeEach(() => {
  state.row = { customHeadCode: HEAD, customFooterCode: FOOT };
  state.boom = false;
  extras.speed = false;
  extras.analytics = false;
});

describe("header and footer code on deployed and Plexo-made apps", () => {
  it("adds the owner's code to a full page and fixes the length", async () => {
    const out = await withAppPageExtras(html(APP), site);
    const text = await out.text();
    expect(text).toContain(HEAD);
    expect(text).toContain(FOOT);
    expect(text.indexOf(HEAD)).toBeLessThan(text.indexOf("</head>"));
    expect(out.headers.get("content-length")).toBeNull();
    expect(out.headers.get("content-type")).toMatch(/text\/html/);
  });
  it("never touches JSON, fragments, errors, redirects or other files", async () => {
    const json = new NextResponse('{"a":1}', { headers: { "Content-Type": "application/json" } });
    expect(await (await withAppPageExtras(json, site)).text()).toBe('{"a":1}');
    const fragment = "<div>just a snippet</div>";
    expect(await (await withAppPageExtras(html(fragment), site)).text()).toBe(fragment);
    expect(await (await withAppPageExtras(html(APP, { status: 404 }), site)).text()).toBe(APP);
    const redirect = NextResponse.redirect("https://x.com/", 301);
    expect((await withAppPageExtras(redirect, site)).status).toBe(301);
  });
  it("follows the same plan and domain rules as every other page", async () => {
    expect(await (await withAppPageExtras(html(APP), { ...site, plan: "FREE" })).text()).toBe(APP);
    expect(await (await withAppPageExtras(html(APP), { ...site, type: "SUBDOMAIN" })).text()).toBe(APP);
    expect(await (await withAppPageExtras(html(APP), { ...site, secFetchDest: "iframe" })).text()).toBe(APP);
  });
  it("stays off the app's payment pages unless the owner allowed it", async () => {
    const pay = APP.replace("<div id=root></div>", "<div data-plexo-commerce-checkoutflow></div>");
    expect(await (await withAppPageExtras(html(pay), site)).text()).toBe(pay);
    state.row = { ...state.row, customCodeOnCheckout: true };
    expect(await (await withAppPageExtras(html(pay), site)).text()).toContain(HEAD);
  });
  it("is once-only and never loses the page when something fails", async () => {
    const once = await (await withAppPageExtras(html(APP), site)).text();
    expect(await (await withAppPageExtras(html(once), site)).text()).toBe(once);
    state.boom = true;
    expect(await (await withAppPageExtras(html(APP), site)).text()).toBe(APP);
  });
  it("leaves very large pages alone", async () => {
    const big = APP + "x".repeat(2.1 * 1024 * 1024);
    expect(await (await withAppPageExtras(html(big), site)).text()).toBe(big);
  });
});

describe("speed options and Google Analytics on apps", () => {
  it("adds them even on the free address and Free plan, where the owner's code isn't allowed", async () => {
    extras.speed = true;
    extras.analytics = true;
    const text = await (await withAppPageExtras(html(APP), { ...site, plan: "FREE", type: "SUBDOMAIN" })).text();
    expect(text).toContain('content="Speedy"');
    expect(text).toContain("<!--ga-->");
    expect(text).not.toContain(HEAD);
  });
  it("puts Google Analytics after the owner's code", async () => {
    extras.analytics = true;
    const text = await (await withAppPageExtras(html(APP), site)).text();
    expect(text.indexOf(HEAD)).toBeLessThan(text.indexOf("<!--ga-->"));
  });
  it("leaves JSON and fragments alone", async () => {
    extras.speed = true;
    extras.analytics = true;
    const fragment = "<div>snippet</div>";
    expect(await (await withAppPageExtras(html(fragment), site)).text()).toBe(fragment);
  });
});
