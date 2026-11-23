import { describe, expect, it } from "vitest";
import { BUSINESS_KINDS, buildArticleSchema, buildBusinessSchema, buildFaqSchema, checkCanonical, checkSchemaJson, emptyBusiness, isPageNoindex, readPageSeoExtras, resolveCanonical, schemaItemsToPublish } from "@/lib/seo/pageSeo";
import { buildRobotsTxt, checkFolder, checkRobotsText, parseRobotsConfig } from "@/lib/seo/robots";
import { injectSeoTags } from "@/lib/pub/htmlInject";

const page = (head = "") => `<!doctype html><html><head>${head}</head><body>x</body></html>`;
const base = { canonicalUrl: "https://a.com/about", noindex: false, siteName: "A" };

describe("a page's own search settings", () => {
  it("reads them from either editor's meta", () => {
    expect(readPageSeoExtras({ meta: { noindex: "1", canonicalUrl: "/x" } })).toMatchObject({ noindex: true, canonicalUrl: "/x" });
    expect(readPageSeoExtras({ body: { style: { noindex: "1" } } }).noindex).toBe(true);
    expect(isPageNoindex({ meta: {} })).toBe(false);
    expect(isPageNoindex(null)).toBe(false);
  });

  it("accepts a page of this site or a full https address, and refuses anything else in plain words", () => {
    expect(checkCanonical("")).toEqual({ ok: true, value: "" });
    expect(checkCanonical("/pricing")).toEqual({ ok: true, value: "/pricing" });
    expect(checkCanonical("https://example.com/a")).toMatchObject({ ok: true });
    for (const bad of ["javascript:alert(1)", "http://example.com", "//evil.com", "https://user:pw@example.com", "not a url", "/a b", "https://localhost"]) {
      const r = checkCanonical(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
    expect(resolveCanonical("/pricing", "a.com")).toBe("https://a.com/pricing");
    expect(resolveCanonical("https://b.com/x", "a.com")).toBe("https://b.com/x");
  });
});

describe("structured data", () => {
  it("builds a business with only what was filled in", () => {
    const o = buildBusinessSchema(emptyBusiness({ name: "Haven Realty", kind: "RealEstateAgent", phone: "+351 21 555 0100", street: "Avenida Marginal 214", city: "Cascais", hours: "Mo-Sa 09:00-19:00" }));
    expect(o).toMatchObject({ "@context": "https://schema.org", "@type": "RealEstateAgent", name: "Haven Realty", telephone: "+351 21 555 0100", openingHours: "Mo-Sa 09:00-19:00" });
    expect(o.address).toMatchObject({ "@type": "PostalAddress", streetAddress: "Avenida Marginal 214", addressLocality: "Cascais" });
    expect(o).not.toHaveProperty("email");
    expect(buildBusinessSchema(emptyBusiness({ name: "X", kind: "<script>" }))["@type"]).toBe("LocalBusiness");
    expect(BUSINESS_KINDS.length).toBeGreaterThan(3);
  });

  it("builds a FAQ from complete rows only, and an article", () => {
    const faq = buildFaqSchema([{ question: "Do you ship?", answer: "Yes" }, { question: "Half", answer: "" }]);
    expect((faq.mainEntity as unknown[]).length).toBe(1);
    expect(buildArticleSchema({ headline: "H", author: "Ama", datePublished: "2026-11-23", image: "", description: "" })).toMatchObject({ "@type": "Article", headline: "H", author: { name: "Ama" } });
  });

  it("checks what is typed: valid data passes, with advice; mistakes say what to fix", () => {
    const good = checkSchemaJson(JSON.stringify(buildBusinessSchema(emptyBusiness({ name: "Haven" }))));
    expect(good.ok).toBe(true);
    expect(good.types).toEqual(["LocalBusiness"]);
    expect(good.tips.join(" ")).toMatch(/address/);
    expect(checkSchemaJson("").ok).toBe(true);
    expect(checkSchemaJson("{ broken").problems[0]).toMatch(/valid JSON/);
    expect(checkSchemaJson('{"@type":"Thing"}').json).toContain("https://schema.org"); // a missing context is added
    expect(checkSchemaJson('{"@context":"https://evil.example","@type":"Thing"}').ok).toBe(false);
    expect(checkSchemaJson('{"@context":"https://schema.org"}').problems[0]).toMatch(/@type/);
    expect(checkSchemaJson('{"@type":"FAQPage","mainEntity":[]}').ok).toBe(false);
    expect(checkSchemaJson('{"@type":"LocalBusiness"}').problems[0]).toMatch(/name/);
    expect(checkSchemaJson("x".repeat(30_000)).ok).toBe(false);
    expect(checkSchemaJson(JSON.stringify(Array.from({ length: 11 }, () => ({ "@type": "Thing" })))).ok).toBe(false);
  });

  it("accepts data pasted inside its script tag", () => {
    const r = checkSchemaJson('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Thing","name":"x"}</script>');
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.json).name).toBe("x");
  });

  it("only ever publishes data that passes the check again, so a hand-edited record cannot inject anything", () => {
    expect(schemaItemsToPublish("<img onerror=alert(1)>")).toEqual([]);
    expect(schemaItemsToPublish('{"@context":"https://schema.org","@type":"Thing","name":"</script><script>alert(1)</script>"}')).toHaveLength(1);
  });
});

describe("published page tags", () => {
  it("keeps a page out of search when asked, and still adds the site's own details", () => {
    const out = injectSeoTags(page(), { ...base, pageNoindex: true });
    expect(out).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(out).toContain("WebSite");
    expect(injectSeoTags(page(), base)).not.toContain("noindex");
  });

  it("uses the owner's main address, replacing the page's own", () => {
    const own = page('<link rel="canonical" href="https://old.example/p">');
    expect(injectSeoTags(own, base)).toContain("https://old.example/p"); // respected when the owner said nothing
    const out = injectSeoTags(own, { ...base, canonicalOverride: "https://a.com/new" });
    expect(out).toContain('href="https://a.com/new"');
    expect(out).not.toContain("old.example");
    expect((out.match(/rel="canonical"/g) ?? []).length).toBe(1);
  });

  it("adds the owner's structured data on top, escaped so it cannot break out of the script tag", () => {
    const out = injectSeoTags(page(), { ...base, extraJsonLd: [{ "@context": "https://schema.org", "@type": "Thing", name: "</script><script>alert(1)</script>" }] });
    expect(out.match(/application\/ld\+json/g)?.length).toBe(2); // the site's own + the owner's
    expect(out).not.toContain("</script><script>alert(1)");
  });
});

describe("robots.txt", () => {
  it("is Plexo's own file by default, with the sitemap line", () => {
    expect(buildRobotsTxt("a.com", false)).toBe("User-agent: *\nAllow: /\n\nSitemap: https://a.com/sitemap.xml\n");
  });

  it("keeps chosen folders out and everything else open", () => {
    const cfg = parseRobotsConfig({ mode: "folders", folders: ["private", "/members/", "private", "bad folder", "/"] });
    expect(cfg.folders).toEqual(["/private/", "/members/"]);
    const txt = buildRobotsTxt("a.com", false, cfg);
    expect(txt).toContain("Disallow: /private/");
    expect(txt).toContain("Disallow: /members/");
    expect(txt).toContain("Sitemap: https://a.com/sitemap.xml");
    expect(checkFolder("a*b")).toBeNull();
  });

  it("checks a hand-written file line by line and always keeps the sitemap line", () => {
    expect(checkRobotsText("User-agent: *\nDisallow: /tmp/").ok).toBe(true);
    expect(checkRobotsText("Disallow: /tmp/").problems[0]).toMatch(/User-agent/);
    expect(checkRobotsText("hello world").problems[0]).toMatch(/Line 1/);
    expect(checkRobotsText("User-agent: *\nDisallow: /").warnings[0]).toMatch(/whole site/);
    expect(checkRobotsText("User-agent: *\nDisallow: /sitemap.xml").warnings[0]).toMatch(/sitemap/);
    expect(checkRobotsText("User-agent: *\nSitemap: http://a.com/s.xml").ok).toBe(false);
    expect(checkRobotsText("x".repeat(6000)).ok).toBe(false);
    const mine = buildRobotsTxt("a.com", false, { mode: "custom", folders: [], custom: "User-agent: Googlebot\nDisallow: /tmp/" });
    expect(mine).toContain("Disallow: /tmp/");
    expect(mine).toContain("Sitemap: https://a.com/sitemap.xml");
  });

  it("falls back to the default when a saved custom file is no longer valid, and a site kept out of search always blocks everything", () => {
    expect(buildRobotsTxt("a.com", false, { mode: "custom", folders: [], custom: "nonsense" })).toContain("Allow: /");
    expect(buildRobotsTxt("a.com", true, { mode: "folders", folders: ["/x/"], custom: "" })).toBe("User-agent: *\nDisallow: /\n");
    expect(parseRobotsConfig("not json")).toEqual({ mode: "default", folders: [], custom: "" });
  });
});
