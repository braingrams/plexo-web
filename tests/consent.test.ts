import { afterEach, describe, expect, it, vi } from "vitest";
import { CONSENT_COUNTRIES, consentRequiredFor, visitorCountry } from "@/lib/consent/regions";
import { DEFAULT_CONSENT, normalizeConsentInput } from "@/lib/consent/model";
import { analyticsSnippet, readableOn } from "@/lib/consent/snippet";
import { injectGoogleAnalyticsTag } from "@/lib/pub/htmlInject";

afterEach(() => vi.unstubAllEnvs());
const h = (o: Record<string, string>) => new Headers(o);

describe("who needs a cookie notice", () => {
  it("covers the EEA, UK, Switzerland and Brazil", () => {
    for (const c of ["DE", "FR", "IE", "NO", "IS", "LI", "GB", "CH", "BR"]) expect(consentRequiredFor(c)).toBe(true);
    expect(CONSENT_COUNTRIES.size).toBe(27 + 3 + 2 + 1);
  });
  it("does not ask visitors elsewhere", () => {
    for (const c of ["NG", "US", "GH", "IN", "CA", "ZA"]) expect(consentRequiredFor(c)).toBe(false);
  });
  it("asks when the country is unknown (the safe mistake)", () => {
    expect(consentRequiredFor(null)).toBe(true);
    expect(consentRequiredFor(visitorCountry(h({})))).toBe(true);
    expect(visitorCountry(h({ "cloudfront-viewer-country": "XX" }))).toBeNull();
    expect(visitorCountry(h({ "cloudfront-viewer-country": "T1" }))).toBeNull();
  });
  it("reads the country from the edge headers, case-insensitively", () => {
    expect(visitorCountry(h({ "cloudfront-viewer-country": "de" }))).toBe("DE");
    expect(visitorCountry(h({ "x-vercel-ip-country": "NG" }))).toBe("NG");
    expect(visitorCountry(h({ "cf-ipcountry": "BR" }))).toBe("BR");
    expect(visitorCountry(h({ "cloudfront-viewer-country": "<script>" }))).toBeNull();
  });
  it("only honours the local override outside production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONSENT_DEV_COUNTRY", "NG");
    expect(visitorCountry(h({}))).toBeNull();
  });
});

describe("cookie notice settings", () => {
  it("starts on, with friendly wording", () => {
    expect(DEFAULT_CONSENT.enabled).toBe(true);
    expect(DEFAULT_CONSENT.message).toMatch(/cookies/);
  });
  it("accepts small changes and keeps the rest", () => {
    const r = normalizeConsentInput({ position: "card", accentColor: "#1D4ED8", message: "Hi <b>there</b>" });
    expect(r.ok && r.settings.position).toBe("card");
    expect(r.ok && r.settings.accentColor).toBe("#1d4ed8");
    expect(r.ok && r.settings.message).not.toContain("<");
    expect(r.ok && r.settings.acceptLabel).toBe(DEFAULT_CONSENT.acceptLabel);
  });
  it("explains problems in plain words", () => {
    const bad = normalizeConsentInput({ accentColor: "red" });
    expect(!bad.ok && bad.error).toMatch(/colour/);
    expect(normalizeConsentInput({ position: "top" }).ok).toBe(false);
    expect(normalizeConsentInput({ message: "x".repeat(300) }).ok).toBe(false);
    expect(normalizeConsentInput({ enabled: "yes" }).ok).toBe(false);
  });
  it("falls back to the standard wording for an empty box and to the brand for an empty colour", () => {
    const r = normalizeConsentInput({ message: "  ", accentColor: "" }, { ...DEFAULT_CONSENT, accentColor: "#112233" });
    expect(r.ok && r.settings.message).toBe(DEFAULT_CONSENT.message);
    expect(r.ok && r.settings.accentColor).toBeNull();
  });
  it("picks a readable button text colour", () => {
    expect(readableOn("#ffffff")).toBe("#111111");
    expect(readableOn("#0b0b12")).toBe("#ffffff");
  });
});

describe("the page script", () => {
  const base = { measurementId: "G-ABC1234", settings: DEFAULT_CONSENT };
  const configOf = (s: string) => JSON.parse(s.slice(s.lastIndexOf("})(") + 3, s.lastIndexOf(");</script>")));
  it("asks first where consent is required, and never loads Google before the visitor says yes", () => {
    const s = analyticsSnippet({ ...base, required: true });
    expect(configOf(s).ask).toBe(true);
    expect(s).toContain('"consent","default"');
    expect(s).toContain("analytics_storage:\"denied\"");
    // gtag.js is only added by load(), which in the "ask" path runs from grant() alone.
    expect(s.indexOf("if(!C.ask){load();return}")).toBeLessThan(s.indexOf('"consent","default"'));
    expect(s).toContain("plexo_consent");
    expect(s).toContain("Change cookie settings");
  });
  it("loads straight away with no notice elsewhere", () => {
    expect(configOf(analyticsSnippet({ ...base, required: false })).ask).toBe(false);
  });
  it("skips the notice when the owner turned it off", () => {
    expect(configOf(analyticsSnippet({ ...base, required: true, settings: { ...DEFAULT_CONSENT, enabled: false } })).ask).toBe(false);
  });
  it("never puts markup from owner text in the page", () => {
    const s = analyticsSnippet({ ...base, required: true, settings: { ...DEFAULT_CONSENT, message: "</script><script>alert(1)</script>" } });
    expect(s.match(/<\/script>/g)).toHaveLength(1);
  });
  it("is a valid script", () => {
    const body = analyticsSnippet({ ...base, required: true }).replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    expect(() => new Function(body)).not.toThrow();
  });
  it("keeps the notice unobtrusive: fixed, in its own shadow root, no overlay or focus trap", () => {
    const s = analyticsSnippet({ ...base, required: true });
    expect(s).toContain("attachShadow");
    expect(s).toContain("position:fixed");
    expect(s).not.toMatch(/overflow\s*:\s*hidden|\.focus\(\)|backdrop/);
    expect(s).toContain("prefers-reduced-motion");
    expect(s).toContain('role","region"');
  });
});

describe("where the tag goes", () => {
  const consent = { required: true, settings: DEFAULT_CONSENT };
  it("goes first in <head>, so consent is set before anything else", () => {
    const out = injectGoogleAnalyticsTag("<html><head><title>x</title></head><body></body></html>", "G-ABC1234", consent);
    expect(out.indexOf("<script data-plexo-analytics>")).toBe(out.indexOf("<head>") + "<head>".length);
  });
  it("works on a page with no <head> (raw HTML, React shells)", () => {
    expect(injectGoogleAnalyticsTag("<div>hi</div>", "G-ABC1234", consent).startsWith("<script data-plexo-analytics>")).toBe(true);
  });
  it("is not added twice when the owner's own code already has the tag", () => {
    const own = '<html><head><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234"></script></head></html>';
    expect(injectGoogleAnalyticsTag(own, "G-ABC1234", consent)).toBe(own);
  });
  it("at run time does not append a second gtag.js if the page has one", () => {
    expect(analyticsSnippet({ measurementId: "G-ABC1234", required: false, settings: DEFAULT_CONSENT })).toContain('script[src*="googletagmanager.com/gtag/js"]');
  });
});
