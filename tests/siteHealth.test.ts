import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/opsEntities", () => ({ SiteHealthSettings: {}, SiteHealthCheck: {}, SiteGoogleAnalytics: {} }));

import { blockedAiBots, scoreAeo } from "@/lib/siteHealth/aeo";
import { parsePsi, rate } from "@/lib/siteHealth/psi";
import { altFromSrc, applyHealthSettings, buildLlmsTxt, NO_SETTINGS } from "@/lib/siteHealth/serve";
import { buildIssues, scoreLook } from "@/lib/siteHealth/explain";
import { injectGoogleAnalyticsTag } from "@/lib/pub/htmlInject";

const GOOD_PAGE = `<html lang="en"><head><title>Bread | Bakery</title><meta property="og:title" content="Bread"><meta property="og:description" content="Fresh bread."><link rel="canonical" href="https://a.com/"><meta name="description" content="We bake fresh bread every morning in Lagos and deliver it to your door before breakfast."><script type="application/ld+json">{"@type":"Organization"}</script></head><body><h1>Bread</h1><h2>Menu</h2><img src="a.jpg" alt="Loaf"></body></html>`;

describe("AI visibility score", () => {
  it("scores a well-marked-up page at 100", () => {
    const r = scoreAeo({ html: GOOD_PAGE, robotsTxt: "User-agent: *\nAllow: /", llmsTxtExists: true, sitemapExists: true });
    expect(r.score).toBe(100);
  });
  it("flags what is missing", () => {
    const r = scoreAeo({ html: "<html><head></head><body><img src='x.png'></body></html>", robotsTxt: null, llmsTxtExists: false, sitemapExists: false });
    const failed = r.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["structured_data", "headings", "meta_description", "llms_txt", "sitemap", "alt_text", "canonical", "language", "title", "open_graph"]));
    expect(r.score).toBeLessThan(40);
  });
  it("finds AI crawlers shut out by robots.txt", () => {
    expect(blockedAiBots("User-agent: GPTBot\nDisallow: /\n")).toEqual(["GPTBot"]);
    expect(blockedAiBots("User-agent: *\nDisallow: /\n")).toContain("ClaudeBot");
    expect(blockedAiBots("User-agent: *\nAllow: /\n")).toEqual([]);
  });
});

describe("speed report", () => {
  it("rates with Google's cut-offs", () => {
    expect(rate("lcp", 2.4)).toBe("good");
    expect(rate("lcp", 3.5)).toBe("okay");
    expect(rate("lcp", 5)).toBe("poor");
    expect(rate("cls", 0.3)).toBe("poor");
  });
  it("parses Google's answer, preferring real visitor data", () => {
    const r = parsePsi({
      lighthouseResult: { categories: { performance: { score: 0.81 }, seo: { score: 1 }, accessibility: { score: 0.9 }, "best-practices": { score: 0.96 } }, audits: { "largest-contentful-paint": { numericValue: 4200 }, "first-contentful-paint": { numericValue: 1500 }, "image-alt": { score: 0, scoreDisplayMode: "binary" } } },
      loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 }, INTERACTION_TO_NEXT_PAINT: { percentile: 150 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 } } },
    });
    expect(r.speed).toBe(81);
    expect(r.lcp).toEqual({ value: 2.1, rating: "good", source: "visitors" });
    expect(r.cls?.value).toBeCloseTo(0.05);
    expect(r.failedAudits).toContain("image-alt");
    expect(r.hasRealVisitorData).toBe(true);
  });
  it("labels scores in words", () => {
    expect(scoreLook(95).label).toBe("Great");
    expect(scoreLook(100).label).toBe("Perfect");
    expect(scoreLook(40).tone).toBe("poor");
  });
});

describe("fix it for me, at serve time", () => {
  const ctx = { canonicalUrl: "https://a.com/", siteName: "Bakery" };
  it("adds a description, business details and a language only where missing", () => {
    const out = applyHealthSettings("<html><head></head><body></body></html>", { ...NO_SETTINGS, fallbackDescription: "Fresh bread daily.", organizationSchema: true, language: "en" }, ctx);
    expect(out).toContain('<html lang="en"');
    expect(out).toContain('name="description" content="Fresh bread daily."');
    expect(out).toContain('"@type":"Organization"');
    expect(applyHealthSettings(GOOD_PAGE, { ...NO_SETTINGS, fallbackDescription: "Other", language: "fr" }, ctx)).toBe(GOOD_PAGE);
  });
  it("describes pictures from their file name, never guessing from a hash", () => {
    expect(altFromSrc("/uploads/our-team_photo.jpg")).toBe("Our team photo");
    expect(altFromSrc("/uploads/3f9a1c7e22b04d55.jpg")).toBeNull();
    const out = applyHealthSettings('<img src="/x/market-stall.png"><img src="/y/a.png" alt="Kept">', { ...NO_SETTINGS, altFromFilename: true }, ctx);
    expect(out).toContain('alt="Market stall"');
    expect(out).toContain('alt="Kept"');
  });
  it("makes later videos wait but not the first", () => {
    const out = applyHealthSettings('<iframe src="a"></iframe><iframe src="b"></iframe>', { ...NO_SETTINGS, lazyEmbeds: true }, ctx);
    expect(out.match(/loading="lazy"/g)).toHaveLength(1);
  });
  it("writes llms.txt", () => {
    const t = buildLlmsTxt({ siteName: "Bakery", description: "Bread.", pages: [{ loc: "https://a.com/", name: "Home" }] });
    expect(t).toContain("# Bakery");
    expect(t).toContain("- [Home](https://a.com/)");
  });
});

describe("issues", () => {
  it("offers a one-click fix and manual steps for each problem it can fix", () => {
    const aeo = scoreAeo({ html: "<html><head></head><body><h1>x</h1></body></html>", robotsTxt: null, llmsTxtExists: false, sitemapExists: true });
    const issues = buildIssues({ speed: null, aeo, settings: NO_SETTINGS });
    const ids = issues.map((i) => i.autoFix?.id).filter(Boolean);
    expect(ids).toEqual(expect.arrayContaining(["meta_description", "llms_txt", "organization_schema", "language"]));
    for (const i of issues) expect(i.steps.length).toBeGreaterThan(0);
  });
});

describe("Google Analytics tag", () => {
  it("only writes a well-formed ID, once", () => {
    expect(injectGoogleAnalyticsTag("<head></head>", 'G-ABC123"><script>')).toBe("<head></head>");
    const once = injectGoogleAnalyticsTag("<head></head>", "G-ABC1234");
    expect(once).toContain("googletagmanager.com/gtag/js");
    expect(once).toContain("G-ABC1234");
    expect(injectGoogleAnalyticsTag(once, "G-ABC1234")).toBe(once);
  });
});
