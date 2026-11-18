import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailColorsFromTokens } from "@/lib/brand/emailBrand";
import { __resetPlexoBrandForTests, FALLBACK_BRAND, fetchPlexoBrandFromStrata, getLastKnownPlexoBrand, getPlexoBrand, plexoBrandCssVars, type PlexoBrand } from "@/lib/brand/plexoBrand";
import { __clearLogoCacheForTests, bundledLogo, getPlexoLogo, svgLooksSafe } from "@/lib/brand/plexoLogos";
import { contrastRatio, mapStrataTokens, onColorFor, parseVariablesCss, resolveLogoAssets, type StrataAsset } from "@/lib/brand/strataTokens";
import { GET } from "@/app/api/brand/logo/[kind]/route";
import { EMAIL_COLORS, EMAIL_COLORS_DEFAULT } from "@/lib/theme";
import { emailShell, EMAIL_LOGO } from "@/lib/mail/maildrip";
import { FALLBACK_LOGO_FILES } from "@/lib/brand/fallbackAssets";
import { LOGO_KINDS } from "@/lib/brand/strataTokens";

vi.mock("@/lib/mail/logEmail", () => ({ logEmailDelivery: () => {} }));
const fx = (n: string) => readFileSync(join(__dirname, "fixtures/strata", n), "utf8");
const css = fx("variables.css");
const project = JSON.parse(fx("project.json")) as { project: { logo: string; designSystemData: { assets: StrataAsset[] } } };
const assets = project.project.designSystemData.assets;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const CDN = "https://dx2nhw7wqn4nn.cloudfront.net/x";

describe("token mapping", () => {
  it("resolves var() references and maps the real published tokens", () => {
    const vars = parseVariablesCss(css);
    expect(vars["color-action-primary"]).toBe("#B8F34A");
    const t = mapStrataTokens(vars);
    expect(t.light["color-action-primary-bg"]).toBe("#B8F34A");
    expect(t.light["color-brand-deep"]).toBe("#517A12");
    expect(t.light["color-brand-accent"]).toBe("#F5AC05");
    expect(t.light["color-action-primary-text"]).toBe("#121212");
    expect(t.dark["color-brand-primary"]).toBe("#B8F34A");
    expect(t.light["radius-control"]).toBe("12px");
    expect(t.light["font-family-base"]).toContain("var(--font-v3-sans)");
    expect(t.dark["color-bg-canvas"]).toBeUndefined();
  });
  it("rejects hostile values per token and keeps the rest", () => {
    const t = mapStrataTokens({
      "color-brand-primary": "url(https://evil/x)",
      "color-brand-accent": "red; } body{display:none",
      "color-brand-secondary": "#517A12",
      "font-family-base": "Inter; } a{x:url(x)",
      "radius-md": "12px; x:y",
      "radius-lg": "20px",
    });
    expect(t.light["color-brand-primary"]).toBeUndefined();
    expect(t.light["color-brand-accent"]).toBeUndefined();
    expect(t.light["font-family-base"]).toBeUndefined();
    expect(t.light["radius-control"]).toBeUndefined();
    expect(t.light["color-brand-deep"]).toBe("#517A12");
    expect(t.light["radius-card"]).toBe("20px");
  });
  it("flips the on-colour for a dark primary and keeps bundled text pairs that fail contrast", () => {
    const t = mapStrataTokens({ "color-brand-primary": "#091296", "color-bg-page": "#222222", "color-text-primary": "#333333" });
    expect(t.light["color-action-primary-text"]).toBe("#FFFFFF");
    expect(t.dark["color-action-primary-text"]).toBe("#FFFFFF");
    expect(contrastRatio("#091296", "#FFFFFF")).toBeGreaterThan(4.5);
    expect(t.light["color-bg-canvas"]).toBeUndefined();
    expect(t.light["color-text-primary"]).toBeUndefined();
    expect(onColorFor("#B8F34A")).toBe("#121212");
  });
});

describe("logo resolution by role and metadata", () => {
  it("finds all six kinds in the real asset list", () => {
    const l = resolveLogoAssets(assets, project.project.logo);
    for (const k of LOGO_KINDS) expect(l[k], k).toMatch(/^https:\/\/dx2nhw7wqn4nn\.cloudfront\.net\//);
    expect(l["wordmark-on-light"]).toContain("logo-dark.svg");
    expect(l["wordmark-on-dark"]).toContain("logo-light.svg");
    expect(l["email-on-light"]).toContain("plexo-wordmark-dark.png");
    expect(l["email-on-dark"]).toContain("plexo-wordmark-light.png");
    expect(l.icon).toContain("plexo-mark.png");
    expect(l["app-icon"]).toContain("plexo-mark-tile.png");
  });
  it("newest wins, and a replaced logo flows through with a new URL", () => {
    const replaced: StrataAsset[] = [...assets, { type: "LOGO", role: "PRIMARY", cdnUrl: "https://abc.cloudfront.net/new-logo.svg", mimeType: "image/svg+xml", metadata: {} }];
    expect(resolveLogoAssets(replaced)["wordmark-on-light"]).toBe("https://abc.cloudfront.net/new-logo.svg");
    const dated: StrataAsset[] = [
      { type: "LOGO", role: "FAVICON", cdnUrl: "https://a.cloudfront.net/new.png", updatedAt: "2026-02-01T00:00:00Z" },
      { type: "LOGO", role: "FAVICON", cdnUrl: "https://a.cloudfront.net/old.png", updatedAt: "2026-01-01T00:00:00Z" },
    ];
    expect(resolveLogoAssets(dated).icon).toBe("https://a.cloudfront.net/new.png");
  });
  it("drops non-https, foreign hosts and svg for email", () => {
    const bad: StrataAsset[] = [
      { type: "LOGO", role: "PRIMARY", cdnUrl: "http://x.cloudfront.net/a.svg" },
      { type: "LOGO", role: "MONO_LIGHT", cdnUrl: "https://evil.example.com/a.svg" },
      { type: "LOGO", metadata: { usage: "email", background: "light" }, cdnUrl: "https://x.cloudfront.net/a.svg", mimeType: "image/svg+xml" },
    ];
    const l = resolveLogoAssets(bad);
    expect(l["wordmark-on-light"]).toBeNull();
    expect(l["wordmark-on-dark"]).toBeNull();
    expect(l["email-on-light"]).toBeNull();
  });
});

function mockStrata(over: { cssOk?: boolean; logoBody?: Uint8Array; logoType?: string; logoText?: string } = {}) {
  const f = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/v1/public/projects/")) return new Response(JSON.stringify(project), { status: 200 });
    if (u.endsWith("variables.css")) return over.cssOk === false ? new Response("no", { status: 500 }) : new Response(css, { status: 200 });
    if (u.includes("cloudfront.net")) {
      const body = over.logoText ?? over.logoBody ?? PNG;
      return Object.assign(new Response(body as BodyInit, { status: 200, headers: { "content-type": over.logoType ?? "image/png" } }), { });
    }
    return new Response("?", { status: 404 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("live reader", () => {
  beforeEach(() => {
    process.env.PLEXO_BRAND_STRATA = "on";
    __resetPlexoBrandForTests();
    __clearLogoCacheForTests();
  });
  afterEach(() => {
    process.env.PLEXO_BRAND_STRATA = "off";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads tokens + logos from the fixtures and caches for 60s", async () => {
    const f = mockStrata();
    const b = await getPlexoBrand();
    expect(b.source).toBe("strata");
    expect(b.tokens.light["color-brand-accent"]).toBe("#F5AC05");
    expect(b.logos.emailOnLight).toContain("plexo-wordmark-dark.png");
    await getPlexoBrand();
    expect(f).toHaveBeenCalledTimes(2); // project + css, once
    expect(getLastKnownPlexoBrand().source).toBe("strata");
  });

  it("serves the last good brand when Strata later fails (stale-while-error), bundled when never reachable", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    mockStrata();
    const good = await getPlexoBrand();
    vi.setSystemTime(Date.now() + 120_000);
    mockStrata({ cssOk: false });
    expect((await getPlexoBrand()).revision).toBe(good.revision);
    __resetPlexoBrandForTests();
    expect(await getPlexoBrand()).toBe(FALLBACK_BRAND);
  });

  it("kill switch: PLEXO_BRAND_STRATA=off never touches the network", async () => {
    process.env.PLEXO_BRAND_STRATA = "off";
    const f = mockStrata();
    expect(await getPlexoBrand()).toBe(FALLBACK_BRAND);
    expect(f).not.toHaveBeenCalled();
    const logo = await getPlexoLogo("icon");
    expect(logo.source).toBe("fallback");
  });

  it("fetchPlexoBrandFromStrata revision changes when the tokens change", async () => {
    mockStrata();
    const a = await fetchPlexoBrandFromStrata();
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).includes("/v1/public") ? new Response(JSON.stringify(project)) : new Response(css.replace("#B8F34A", "#C8F34A")))));
    expect((await fetchPlexoBrandFromStrata()).revision).not.toBe(a.revision);
  });

  it("plexoBrandCssVars exposes validated, Strata-named variables", async () => {
    mockStrata();
    const v = await plexoBrandCssVars();
    expect(v).toMatch(/^:root\{/);
    expect(v).toContain("--color-brand-primary:#B8F34A;");
    expect(v).toContain("--color-on-action-primary:#121212;");
    expect(v).toContain("/api/brand/logo/wordmark-on-light");
  });
});

describe("logo proxy route", () => {
  beforeEach(() => {
    process.env.PLEXO_BRAND_STRATA = "on";
    __resetPlexoBrandForTests();
    __clearLogoCacheForTests();
  });
  afterEach(() => {
    process.env.PLEXO_BRAND_STRATA = "off";
    vi.unstubAllGlobals();
  });
  const get = (kind: string, headers: Record<string, string> = {}) => GET(new Request(`http://x/api/brand/logo/${kind}`, { headers }), { params: Promise.resolve({ kind }) });

  it("streams the Strata bytes with cache headers and an ETag", async () => {
    mockStrata();
    const res = await get("email-on-light");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300, stale-while-revalidate=86400");
    const etag = res.headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    mockStrata();
    expect((await get("email-on-light", { "if-none-match": etag })).status).toBe(304);
  });

  it("serves the bundled file when Strata is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const res = await get("wordmark-on-dark");
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bundledLogo("wordmark-on-dark").bytes);
  });

  it("falls back on a bad content-type, an oversized file, a scripted SVG, and an SVG for email", async () => {
    for (const o of [{ logoType: "text/html" }, { logoBody: new Uint8Array(2 * 1024 * 1024 + 1) }]) {
      mockStrata(o);
      __clearLogoCacheForTests();
      expect((await getPlexoLogo("icon")).source).toBe("fallback");
    }
    mockStrata({ logoType: "image/svg+xml", logoText: "<svg onload=\"x()\"><script>1</script></svg>" });
    expect((await getPlexoLogo("wordmark-on-light")).source).toBe("fallback");
    mockStrata({ logoType: "image/svg+xml", logoText: "<svg xmlns='http://www.w3.org/2000/svg'/>" });
    expect((await getPlexoLogo("wordmark-on-light")).source).toBe("strata");
    expect((await getPlexoLogo("email-on-light")).source).toBe("fallback");
    expect(svgLooksSafe("<svg><path d='M0'/></svg>")).toBe(true);
  });

  it("404s an unknown kind", async () => {
    expect((await get("../../etc")).status).toBe(404);
  });

  it("bundled fallback files exist for every kind", () => {
    for (const k of LOGO_KINDS) expect(FALLBACK_LOGO_FILES[k].base64.length).toBeGreaterThan(100);
  });
});

describe("emails", () => {
  it("use the proxy URLs and the bundled colours by default", () => {
    expect(EMAIL_LOGO.onLight).toMatch(/\/api\/brand\/logo\/email-on-light$/);
    const html = emailShell({ title: "t", bodyHtml: "x" });
    expect(html).toContain("/api/brand/logo/email-on-light");
    expect(html).toContain("/api/brand/logo/email-on-dark");
    expect(html).not.toContain("/brand/plexo-wordmark");
    expect(emailColorsFromTokens(FALLBACK_BRAND.tokens)).toEqual(EMAIL_COLORS_DEFAULT);
  });
  it("take live colours from the brand", () => {
    const live: PlexoBrand = { ...FALLBACK_BRAND, tokens: mapStrataTokens({ "color-brand-primary": "#091296", "color-brand-secondary": "#1F2A9A" }) };
    const c = emailColorsFromTokens(live.tokens);
    expect(c.brand).toBe("#091296");
    expect(c.onBrand).toBe("#FFFFFF");
    expect(c.brandTint).not.toBe(EMAIL_COLORS_DEFAULT.brandTint);
  });
});

import { plexoAuthCss } from "@/lib/brand/authCss";
describe("auth stylesheet", () => {
  afterEach(() => { process.env.PLEXO_BRAND_STRATA = "off"; vi.unstubAllGlobals(); });
  it("re-declares the auth variables from the live brand, scoped by theme", async () => {
    process.env.PLEXO_BRAND_STRATA = "on";
    __resetPlexoBrandForTests();
    mockStrata();
    const out = await plexoAuthCss();
    expect(out).toContain("--color-action-primary-bg:#B8F34A;");
    expect(out).toContain('[data-ax-theme="dark"]');
    expect(out).not.toContain("--aside-bg"); // primary unchanged: the bundled gradient stays
    __resetPlexoBrandForTests();
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).includes("/v1/public") ? new Response(JSON.stringify(project)) : new Response(css.replace(/#B8F34A/g, "#091296")))));
    expect(await plexoAuthCss()).toContain("--aside-bg:linear-gradient");
  });
  it("is empty-valued but valid with the kill switch", async () => {
    __resetPlexoBrandForTests();
    expect(await plexoAuthCss()).toContain("[data-ax-theme");
  });
});
