import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// An in-memory stand-in for the health options table, so fixes can be applied and undone for real.
const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("@/lib/db/opsEntities", () => {
  const rows = store;
  const SiteHealthSettings = {
    get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: rows.get(templateId) ?? null }) }),
    upsert: (item: { templateId: string }) => ({ go: async () => void rows.set(item.templateId, { ...(rows.get(item.templateId) ?? {}), ...item }) }),
    patch: ({ templateId }: { templateId: string }) => ({ remove: (keys: string[]) => ({ go: async () => void keys.forEach((k) => delete rows.get(templateId)?.[k]) }) }),
  };
  return { SiteHealthSettings, SiteHealthCheck: {}, SiteGoogleAnalytics: {} };
});
vi.mock("@/lib/db/contentEntities", () => ({ Template: {}, PublishedDomain: {} }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true }));
vi.mock("@/lib/db/commerceEntities", () => ({ CommerceProduct: { query: { primary: () => ({ go: async () => ({ data: [] }) }) } }, CommerceSettings: { get: () => ({ go: async () => ({ data: null }) }) }, CommerceAvailabilityRule: {} }));
vi.mock("@/lib/brand/resolveSiteBrand", () => ({ tryResolveSiteBrand: async () => null }));
vi.mock("@/lib/db/ledgerOperations", () => ({ chargeUsage: async () => ({ creditsCharged: 0 }), ensureCreditPeriod: async () => ({ available: 1000 }), estimateWorstCaseCost: () => 1 }));
vi.mock("@/lib/ai/providers/bedrockClaude", () => ({ generate: async () => ({ text: "We bake fresh bread every morning in Lagos and deliver it to your door before breakfast." }) }));
vi.mock("@/lib/ai/modelRegistry", () => ({ resolveModel: () => "m" }));

import { AEO_WEIGHTS, scoreAeo } from "@/lib/siteHealth/aeo";
import { explainPsiFailure, explainRuntimeError, parsePsi, PsiError, type PsiJson } from "@/lib/siteHealth/psi";
import { applyHealthSettings, applyHealthSettingsWithNotes, NO_SETTINGS } from "@/lib/siteHealth/serve";
import { aiRobotsRules, faqSchema, fastFonts, findQuestions, heroImage, pageTitle, smallerHtml, socialTags } from "@/lib/siteHealth/speedFixes";
import { buildIssues, describeMetrics, fixableCount, gainWords, headline, trendWords } from "@/lib/siteHealth/explain";
import { fixEverything, previewFix, projectAeo, setAutoFix, undoEverything } from "@/lib/siteHealth/fixes";
import { buildSiteRobotsTxt } from "@/lib/pub/siteSitemap";
import { EXTRA_FIX_IDS, type HealthReport, type HealthSettingsView } from "@/lib/siteHealth/types";
import { toView } from "@/lib/siteHealth/serve";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/psi-mobile-sample.json", import.meta.url), "utf8")) as PsiJson;
const ctx = { canonicalUrl: "https://bakery.example/", siteName: "Mama Tee Bakery" };

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <section>
    <h1>Fresh bread</h1>
    <img src="/_next/image?url=%2Fhero-loaf.jpg&w=1920&q=75" loading="lazy" width="1200" height="600">
    <h2>Questions</h2>
    <details><summary>Do you deliver?</summary><p>Yes, across Lagos.</p></details>
    <details><summary>Do you do cakes?</summary><p>Yes, on order.</p></details>
  </section>
  <pre>keep   this
     spacing</pre>
  <script>var a = 1;   var b = "x   y";</script>
</body></html>`;

const tagBalance = (html: string) => {
  const open = (html.match(/<(?!\/|!)[a-z][^>]*>/gi) ?? []).filter((t) => !/^<(meta|link|img|br|hr|input)\b/i.test(t)).length;
  const close = (html.match(/<\/[a-z]+>/gi) ?? []).length;
  return open - close;
};

describe("reading Google's PageSpeed answer", () => {
  const r = parsePsi(fixture);
  it("reads all four scores", () => {
    expect([r.speed, r.seo, r.accessibility, r.bestPractices]).toEqual([63, 92, 87, 100]);
  });
  it("uses the whole site's visitor numbers when the page is too new, and says so", () => {
    expect(r.fieldScope).toBe("site");
    expect(r.lcp).toMatchObject({ value: 3.1, rating: "okay", source: "visitors" });
    expect(r.cls?.value).toBeCloseTo(0.12); // Google sends the CLS percentile times 100
  });
  it("falls back to a lab test and uses total blocking time when INP is missing", () => {
    expect(r.inp).toBeNull();
    expect(r.inpEstimated).toBe(true);
    expect(r.tbt).toMatchObject({ value: 450, rating: "okay", source: "test" });
    const lab = parsePsi({ lighthouseResult: fixture.lighthouseResult });
    expect(lab.lcp).toMatchObject({ value: 4.2, rating: "poor", source: "test" });
    expect(lab.fieldScope).toBeNull();
    expect(lab.hasRealVisitorData).toBe(false);
  });
  it("trusts Google's own fast/average/slow verdict for visitor data", () => {
    const x = parsePsi({ lighthouseResult: fixture.lighthouseResult, loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2400, category: "AVERAGE" } } } });
    expect(x.lcp?.rating).toBe("okay");
    expect(x.fieldScope).toBe("page");
  });
  it("lists savings biggest first, skipping empty ones, and points at elements", () => {
    expect(r.opportunities.map((o) => o.id)).toEqual(["uses-optimized-images", "render-blocking-resources"]);
    expect(r.opportunities[0]).toEqual({ id: "uses-optimized-images", savingsMs: 1200, savingsBytes: 410000 });
    expect(r.elements["heading-order"][0].selector).toBe("main > h4");
    expect(r.elements["image-alt"]).toHaveLength(1);
    expect(r.failedAudits).not.toContain("diagnostics");
  });
  it("turns a page Google could not open into a plain sentence", () => {
    expect(() => parsePsi({ lighthouseResult: { categories: {}, runtimeError: { code: "FAILED_DOCUMENT_REQUEST" } } })).toThrow(/could not open your site/);
    expect(() => parsePsi({})).toThrow(PsiError);
  });
});

describe("plain-words failures", () => {
  it("tells daily quota from a busy moment", () => {
    const daily = explainPsiFailure(429, { error: { message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'" } });
    expect(daily.kind).toBe("quota");
    expect(daily.retryable).toBe(false);
    expect(daily.message).toMatch(/tomorrow/);
    expect(explainPsiFailure(429, { error: { message: "Too many requests" } }).kind).toBe("busy");
  });
  it("recognises the real keyless 429 Google sent us on the day this was built", () => {
    const real = JSON.parse(readFileSync(new URL("./fixtures/psi-real-429-keyless.json", import.meta.url), "utf8"));
    const e = explainPsiFailure(429, real);
    expect(e.kind).toBe("quota");
    expect(e.message).not.toMatch(/Quota exceeded|metric/);
  });
  it("covers unreachable, empty, timeout, key and unknown, never leaking raw text", () => {
    expect(explainPsiFailure(400, { error: { message: "Lighthouse returned error: FAILED_DOCUMENT_REQUEST. Lighthouse was unable to reliably load the page" } }).kind).toBe("unreachable");
    expect(explainPsiFailure(500, { error: { message: "Lighthouse returned error: NO_FCP" } }).kind).toBe("too_new");
    expect(explainPsiFailure(500, { error: { message: "PROTOCOL_TIMEOUT" } }).kind).toBe("timeout");
    expect(explainPsiFailure(403, { error: { message: "API key not valid. key=AIzaSECRET" } }).message).not.toMatch(/AIza|key=/);
    const other = explainPsiFailure(503, null);
    expect(other.retryable).toBe(true);
    expect(explainRuntimeError("NO_FCP")).toMatch(/empty/);
  });
});

describe("explanations", () => {
  const speedOf = (score: number, lcp: number | null) => ({ ...parsePsi(fixture), speed: score, lcp: lcp == null ? null : { value: lcp, rating: "good" as const } });
  it("gives a headline for fast, slower and slow, and celebrates a perfect site", () => {
    const rep = (score: number) => ({ url: "x", speed: speedOf(score, 1.9), aeo: { score: 90, checks: [] } }) as HealthReport;
    expect(headline(rep(95)).text).toMatch(/^Your site is fast/);
    expect(headline(rep(70)).text).toMatch(/^Your site could be faster/);
    expect(headline(rep(30)).text).toMatch(/^Your site is slow/);
    const perfect = headline({ url: "x", speed: { ...speedOf(100, 1), seo: 100 }, aeo: { score: 100, checks: [] } });
    expect(perfect).toMatchObject({ perfect: true, tone: "good" });
    expect(headline({ url: "x", speed: null, aeo: null }).tone).toBeNull();
  });
  it("describes each timing with meaning, limits and a what's-this tip, and swaps INP for TBT when estimated", () => {
    const ms = describeMetrics(parsePsi(fixture));
    expect(ms.map((m) => m.key)).toEqual(["lcp", "fcp", "tbt", "cls"]);
    for (const m of ms) {
      expect(m.meaning.length).toBeGreaterThan(10);
      expect(m.limits).toMatch(/Good is under/);
      expect(m.tip).toMatch(/stands for/);
      expect(m.source).toMatch(/real visitors|test/);
    }
    expect(ms[0].value).toBe("3.1 seconds");
    const withInp = describeMetrics({ ...parsePsi(fixture), inp: { value: 150, rating: "good", source: "visitors" }, inpEstimated: false });
    expect(withInp.map((m) => m.key)).toContain("inp");
  });
  it("estimates savings only from Google's numbers", () => {
    expect(gainWords(1200)).toBe("Could save about 1.2 seconds");
    expect(gainWords(450)).toBe("Could save about 500 milliseconds");
    expect(gainWords(40)).toBeUndefined();
    expect(gainWords(undefined)).toBeUndefined();
  });
  it("orders problems by how much they hurt, and attaches elements for manual ones", () => {
    const aeo = scoreAeo({ html: PAGE, robotsTxt: null, llmsTxtExists: false, sitemapExists: true });
    const issues = buildIssues({ speed: parsePsi(fixture), aeo, settings: NO_SETTINGS, html: PAGE });
    const sevOrder = { poor: 0, okay: 1, good: 2 };
    for (let i = 1; i < issues.length; i++) expect(sevOrder[issues[i - 1].severity]).toBeLessThanOrEqual(sevOrder[issues[i].severity]);
    const heading = issues.find((i) => i.id === "heading_order")!;
    expect(heading.where?.[0].selector).toBe("main > h4");
    expect(heading.autoFix).toBeUndefined();
    expect(issues.find((i) => i.id === "big_images")?.gain).toBe("Could save about 1.2 seconds");
    expect(fixableCount(issues)).toBeGreaterThan(0);
    for (const i of issues) expect(i.steps.length > 0 || i.severity === "good").toBe(true);
  });
  it("describes pictures served through the resizer by their real file name, and never says just 'image'", async () => {
    const { altFromSrc } = await import("@/lib/siteHealth/serve");
    expect(altFromSrc("/_next/image?url=%2Fuploads%2Fhero-loaf.jpg&w=1920&q=75")).toBe("Hero loaf");
    expect(altFromSrc("/_next/image?url=%2Fuploads%2Fimage.jpg&w=1920&q=75")).toBeNull();
    expect(altFromSrc("/x/photo-12.png")).toBeNull();
  });
  it("tells the trend in words", () => {
    expect(trendWords([{ speed: 60, aeo: 70 }])).toBeNull();
    expect(trendWords([{ speed: 60, aeo: 70 }, { speed: 72, aeo: 70 }])).toBe("Since your last check: Speed went up 12 points.");
    expect(trendWords([{ speed: 60, aeo: 70 }, { speed: 60, aeo: 70 }])).toBe("Same as your last check.");
  });
  it("keeps every sentence at grade 6 or easier", () => {
    const grade = (text: string) => {
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      const words = text.match(/[A-Za-z']+/g) ?? [];
      const syl = words.reduce((n, w) => n + Math.max(1, (w.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length), 0);
      return 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
    };
    const aeo = scoreAeo({ html: "<html><head></head><body><img src='a.png'></body></html>", robotsTxt: "User-agent: *\nDisallow: /", llmsTxtExists: false, sitemapExists: false });
    const bad = parsePsi(fixture);
    const issues = buildIssues({ speed: { ...bad, failedAudits: [...bad.failedAudits, "link-name", "target-size", "color-contrast", "font-display", "lcp-lazy-loaded", "unminified-css", "unused-javascript"], cls: { value: 0.3, rating: "poor" } }, aeo, settings: NO_SETTINGS, html: PAGE });
    const texts = [...issues.flatMap((i) => [i.title, i.why, ...i.steps]), ...describeMetrics(bad).flatMap((m) => [m.meaning, m.tip, m.limits])];
    const hard = texts.filter((t) => t.trim().length > 25 && grade(t) > 8).map((t) => `${grade(t).toFixed(1)}: ${t}`);
    expect(hard).toEqual([]);
  });
});

describe("AI visibility checks", () => {
  it("weights add up to 100", () => {
    expect(Object.values(AEO_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  const base = `<html lang="en"><head><title>Bread</title><link rel="canonical" href="https://a/"><meta name="description" content="We bake fresh bread every morning in Lagos and deliver it."><meta property="og:title" content="Bread"><meta property="og:image" content="https://a/i.png"><script type="application/ld+json">{"@type":"LocalBusiness"}</script></head><body><h1>Bread</h1><h2>Menu</h2><img src="a.png" alt="Loaf"></body></html>`;
  const inputs = { html: base, robotsTxt: "User-agent: *\nAllow: /", llmsTxtExists: true, sitemapExists: true };
  const failing = (over: Partial<typeof inputs>) => scoreAeo({ ...inputs, ...over }).checks.filter((c) => !c.passed).map((c) => c.id);
  it("every check passes on a good page and fails on its own flaw", () => {
    expect(failing({})).toEqual([]);
    expect(failing({ html: base.replace(/<title>.*?<\/title>/, "") })).toEqual(["title"]);
    expect(failing({ html: base.replace(/<meta property="og:[^>]*>/g, "") })).toEqual(["open_graph"]);
    expect(failing({ html: base.replace(/<link rel="canonical"[^>]*>/, "") })).toEqual(["canonical"]);
    expect(failing({ html: base.replace(' lang="en"', "") })).toEqual(["language"]);
    expect(failing({ html: base.replace('alt="Loaf"', "") })).toEqual(["alt_text"]);
    expect(failing({ html: base.replace("<h1>Bread</h1>", "") })).toEqual(["headings"]);
    expect(failing({ html: base.replace(/<script[\s\S]*?<\/script>/, "") })).toEqual(["structured_data"]);
    expect(failing({ html: base.replace(/<meta name="description"[^>]*>/, "") })).toEqual(["meta_description"]);
    expect(failing({ llmsTxtExists: false })).toEqual(["llms_txt"]);
    expect(failing({ sitemapExists: false })).toEqual(["sitemap"]);
    expect(failing({ robotsTxt: "User-agent: GPTBot\nDisallow: /" })).toEqual(["ai_crawlers"]);
    expect(failing({ html: base.replace("<h2>Menu</h2>", "<h2>Do you deliver?</h2>") })).toEqual(["faq_markup"]);
  });
});

describe("speed and search fixes: add only what is missing, never twice, never break the page", () => {
  const fixes: [string, (h: string) => { html: string; notes: string[] }][] = [
    ["heroImage", heroImage],
    ["fastFonts", fastFonts],
    ["smallerHtml", smallerHtml],
    ["pageTitle", (h) => pageTitle(h, ctx)],
    ["socialTags", (h) => socialTags(h, ctx)],
    ["faqSchema", faqSchema],
  ];
  const fontPage = `<html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700" rel="stylesheet"><style>@font-face{font-family:X;src:url(x.woff2)}</style></head><body><h1>Hi</h1><img src="/a.jpg" loading="lazy"></body></html>`;
  for (const [name, fn] of fixes) {
    it(`${name}: running it twice changes nothing more`, () => {
      for (const page of [PAGE, fontPage]) {
        const once = fn(page).html;
        expect(fn(once).html).toBe(once);
      }
    });
  }
  it("hero image: loads the first big picture first and removes lazy loading from it", () => {
    const r = heroImage(PAGE);
    expect(r.html).toMatch(/<img[^>]*fetchpriority="high"/);
    expect(r.html).not.toMatch(/<img[^>]*loading="lazy"/);
    expect(r.html).toContain('<link rel="preload" as="image"');
    expect(r.html).toContain('width="1200"');
    expect(heroImage('<html><head></head><body><img src="data:image/gif;base64,AAAA"></body></html>').notes).toEqual([]);
    expect(heroImage("<html><body><p>no pictures</p></body></html>").html).toContain("no pictures");
    // The owner's own priority is respected.
    expect(heroImage('<html><head></head><body><img src="/a.jpg" fetchpriority="low"></body></html>').html).toContain('fetchpriority="low"');
  });
  it("fonts: swap and early connection, only where missing", () => {
    const r = fastFonts(fontPage);
    expect(r.html).toContain("wght@400;700&display=swap");
    expect(r.html).toContain("@font-face{font-display:swap;font-family:X");
    expect(r.html).toContain('rel="preconnect" href="https://fonts.googleapis.com"');
    const already = `<html><head><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=A&display=optional" rel="stylesheet"></head></html>`;
    expect(fastFonts(already).html).toContain("display=optional");
    expect(fastFonts(already).html).not.toContain("display=swap");
  });
  it("smaller pages keep scripts, preformatted text and tag balance exactly", () => {
    const withComment = PAGE.replace("<h1>", "<!-- note to self -->\n<h1>");
    const r = smallerHtml(withComment);
    expect(r.html.length).toBeLessThan(withComment.length);
    expect(r.html).toContain("<pre>keep   this\n     spacing</pre>");
    expect(r.html).toContain('var a = 1;   var b = "x   y";');
    expect(r.html).not.toContain("note to self");
    expect(tagBalance(r.html)).toBe(tagBalance(withComment));
    expect(smallerHtml("<p>a</p>").html).toBe("<p>a</p>");
  });
  it("title: names an untitled page from its heading and site, leaves real titles alone", () => {
    expect(pageTitle(PAGE, ctx).html).toContain("<title>Fresh bread | Mama Tee Bakery</title>");
    const titled = "<html><head><title>My own</title></head><body><h1>X</h1></body></html>";
    expect(pageTitle(titled, ctx).html).toBe(titled);
    expect(pageTitle("<html><head><title> </title></head><body><h1>Cakes</h1></body></html>", ctx).html).toContain("<title>Cakes | Mama Tee Bakery</title>");
  });
  it("sharing tags: only the missing ones, picture made absolute, text escaped", () => {
    const r = socialTags('<html><head><title>A "quoted" <b>name</b></title><meta property="og:title" content="Mine"></head><body><img src="/p.jpg"></body></html>', ctx);
    expect(r.html).toContain('property="og:image" content="https://bakery.example/p.jpg"');
    expect(r.html.match(/og:title/g)).toHaveLength(1);
    expect(r.html).toContain('name="twitter:card" content="summary_large_image"');
    expect(socialTags("<html><head></head><body></body></html>", ctx).html).toContain('name="twitter:card" content="summary"');
  });
  it("questions: finds real pairs, needs two, and never invents or double-adds", () => {
    expect(findQuestions(PAGE).map((q) => q.q)).toEqual(["Do you deliver?", "Do you do cakes?"]);
    const r = faqSchema(PAGE);
    expect(r.html).toContain('"@type":"FAQPage"');
    expect(r.html).toContain("Yes, across Lagos.");
    expect(faqSchema("<html><head></head><body><details><summary>One?</summary>A</details></body></html>").notes).toEqual([]);
    const heads = "<html><head></head><body><h2>Why us?</h2><p>Because.</p><h3>Where?</h3><p>Lagos.</p></body></html>";
    expect(findQuestions(heads)).toHaveLength(2);
  });
  it("robots rules welcome AI crawlers, and noindex stays closed", () => {
    expect(buildSiteRobotsTxt("a.com", false, { aiRules: aiRobotsRules() })).toMatch(/User-agent: GPTBot\nAllow: \/[\s\S]*Sitemap: https:\/\/a\.com\/sitemap\.xml/);
    expect(buildSiteRobotsTxt("a.com", false)).not.toContain("GPTBot");
    expect(buildSiteRobotsTxt("a.com", true, { aiRules: aiRobotsRules() })).toBe("User-agent: *\nDisallow: /\n");
  });
  it("platform scripts are already deferred (nothing extra to defer)", () => {
    const src = readFileSync(new URL("../lib/pub/htmlInject.ts", import.meta.url), "utf8");
    for (const m of src.matchAll(/<script src="\/(commerce|plexo-content|plexo-forms)\.js[^>]*>/g)) expect(m[0]).toMatch(/\bdefer\b/);
  });
});

describe("undo restores the page byte for byte", () => {
  const all: HealthSettingsView = { ...NO_SETTINGS, fallbackDescription: "Fresh bread daily, baked in Lagos every single morning.", llmsTxt: true, organizationSchema: true, lazyEmbeds: true, altFromFilename: true, language: "en", extras: Object.fromEntries(EXTRA_FIX_IDS.map((id) => [id, true])) };
  it("turned off, the page is untouched; turned on, it stays well formed", () => {
    expect(applyHealthSettings(PAGE, NO_SETTINGS, ctx)).toBe(PAGE);
    const on = applyHealthSettings(PAGE, all, ctx);
    expect(on).not.toBe(PAGE);
    expect(applyHealthSettings(on, all, ctx)).toBe(on); // serving an already-fixed page again adds nothing
    expect(on).toMatch(/^<!doctype html><html lang="en">/);
    expect(on).toContain("<pre>keep   this");
    expect((on.match(/<\/head>/g) ?? []).length).toBe(1);
    expect(tagBalance(on)).toBe(tagBalance(PAGE));
  });
  it("notes say what each fix did", () => {
    const { notes } = applyHealthSettingsWithNotes(PAGE, all, ctx);
    for (const id of ["meta_description", "organization_schema", "language", "hero_image", "social_tags", "page_title", "faq_schema", "smaller_html"]) expect(notes[id]?.length, id).toBeGreaterThan(0);
  });
});

describe("applying, previewing and undoing for real", () => {
  const site = { id: "site1", organizationId: "org1", name: "Mama Tee Bakery", compiledHtml: PAGE };
  const last = { url: "https://x", speed: parsePsi(fixture), aeo: scoreAeo({ html: PAGE, robotsTxt: null, llmsTxtExists: false, sitemapExists: true }) } as HealthReport;
  it("previews without changing anything, with a projected AI-visibility gain", async () => {
    store.clear();
    const p = await previewFix(site, "social_tags", NO_SETTINGS, last);
    expect(p.notes.length).toBeGreaterThan(0);
    expect(p.aeo!.to).toBeGreaterThan(p.aeo!.from);
    expect(store.size).toBe(0);
    const d = await previewFix(site, "meta_description", NO_SETTINGS, last);
    expect(d.text).toMatch(/fresh bread/i);
    expect(store.size).toBe(0);
  });
  it("an extra fix turns on and off, and off is exactly as before", async () => {
    store.clear();
    const on = await setAutoFix(site, "hero_image", true);
    expect(on.ok && on.settings.extras.hero_image).toBe(true);
    const again = await setAutoFix(site, "hero_image", true);
    expect(again.ok && again.settings.extras).toEqual({ hero_image: true });
    const off = await setAutoFix(site, "hero_image", false);
    expect(off.ok && off.settings.extras).toEqual({});
  });
  it("uses the summary the owner approved, and rejects one that is too short", async () => {
    store.clear();
    const bad = await setAutoFix(site, "meta_description", true, { text: "Too short" });
    expect(bad.ok).toBe(false);
    const good = await setAutoFix(site, "meta_description", true, { text: "Hand-made sourdough and bread baked fresh in Lagos every day." });
    expect(good.ok && good.settings.fallbackDescription).toMatch(/^Hand-made/);
    const off = await setAutoFix(site, "meta_description", false);
    expect(off.ok && off.settings.fallbackDescription).toBeNull();
  });
  it("Fix everything applies what applies, reports it, and Undo everything clears it all", async () => {
    store.clear();
    const { summary, settings } = await fixEverything(site, NO_SETTINGS, last);
    const done = summary.done.map((d) => d.fix);
    expect(done).toEqual(expect.arrayContaining(["meta_description", "organization_schema", "llms_txt"]));
    expect(summary.aeo!.to).toBeGreaterThan(summary.aeo!.from);
    expect(projectAeo(site.compiledHtml, site.name, settings, last)).toBe(summary.aeo!.to);
    const cleared = await undoEverything(site, toView(store.get("site1")));
    // Details the owner confirmed are kept (switching the fix back on costs nothing) but are not served while it is off.
    expect({ ...cleared, business: null }).toEqual({ ...NO_SETTINGS, extras: {} });
  });
});
