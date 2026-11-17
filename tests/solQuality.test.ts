import { describe, expect, it } from "vitest";
import { checkPage, composite, contrastRatio, formatGateFeedback, parseColor, parseCss, readingGrade, relativeLuminance } from "@/lib/ai/solQuality";
import { parseBrief } from "@/lib/ai/solBrief";
import { blandDocument, pristineDocument } from "./fixtures/solQualityFixtures";

const ids = (html: string, input: Partial<Parameters<typeof checkPage>[0]> = {}) => checkPage({ html, ...input }).findings.map((f) => f.id);
const crumb = parseBrief({ text: "Build a landing page for Crumb & Co. Colours: terracotta #C2410C. Fonts: Fraunces and Inter. No logo." });

describe("contrast math (WCAG 2.x)", () => {
  it("matches the reference values", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(contrastRatio(parseColor("#767676")!, parseColor("#FFFFFF")!)).toBeCloseTo(4.54, 1); // the classic AA threshold grey
    expect(contrastRatio(parseColor("#777777")!, parseColor("#FFFFFF")!)).toBeLessThan(4.5);
  });
  it("reads hex, short hex, rgb and rgba, and composites alpha", () => {
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("var(--x)")).toBeNull();
    expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 })).toMatchObject({ r: 128, g: 128, b: 128, a: 1 });
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
  it("resolves variable chains when reading the page's CSS", () => {
    const { vars } = parseCss(":where(:root){--a:var(--b);--b:#112233}");
    expect(vars.get("--a")).toBe("var(--b)");
  });
  it("flags unreadable text in compiled output and names the colours", () => {
    const html = `<html><head><title>x</title><style>.plx-page{background:#fff}.a{color:#aaaaaa;background:#ffffff}.b{color:#ffffff;background:#1c1917}</style></head><body><div class="plx-page"><section><p class="a">Faint grey sentence</p><p class="b">Light on dark is fine</p></section></div></body></html>`;
    const r = checkPage({ html });
    const f = r.findings.find((x) => x.id === "contrast")!;
    expect(f.severity).toBe("must");
    expect(f.message).toContain("#AAAAAA on #FFFFFF");
    expect(r.stats.worstContrast).toBeLessThan(3);
  });
  it("lets large text pass at 3:1", () => {
    const html = `<html><head><style>.t{color:#949494;background:#ffffff;font-size:32px}</style></head><body><div class="plx-page"><section><h2 class="t">Big headline</h2></section></div></body></html>`;
    expect(ids(html)).not.toContain("contrast");
  });
});

describe("a bland page fails with specific findings", () => {
  const html = blandDocument();
  const report = checkPage({ html, brief: crumb });
  it("does not pass, and the score is low", () => {
    expect(report.passed).toBe(false);
    expect(report.score).toBeLessThan(40);
  });
  it("names the real problems", () => {
    const found = new Set(report.findings.map((f) => f.id));
    for (const id of ["kit-sample-copy", "image-slot-empty", "seo-description", "link-anchor", "empty-section"]) expect(found.has(id)).toBe(true);
  });
  it("the kit's own muted text no longer fails contrast (SDK 2.0.28 and later)", () => {
    // Before the SDK darkened its default muted text (2.5:1), every kit page failed this check.
    expect(report.findings.some((f) => f.id === "contrast")).toBe(false);
  });
  it("every finding says what is wrong and how to fix it", () => {
    for (const f of report.findings) {
      expect(f.message.length).toBeGreaterThan(15);
      expect(f.fix.length).toBeGreaterThan(15);
    }
  });
  it("the feedback to SOL leads with MUST FIX and forbids saying done", () => {
    const text = formatGateFeedback(report, { round: 1, maxRounds: 3, pageName: "Home" });
    expect(text).toMatch(/NOT DONE YET/);
    expect(text).toMatch(/Don't tell the owner it's finished/);
    expect(text.indexOf("MUST FIX")).toBeLessThan(text.indexOf("SHOULD FIX"));
  });
});

describe("a pristine page passes", () => {
  const report = checkPage({ html: pristineDocument(), brief: crumb, knownRoutes: ["/", "/about"] });
  it("has no must-fix findings and a high score", () => {
    expect(report.findings.filter((f) => f.severity === "must")).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.stats.worstContrast).toBeGreaterThanOrEqual(4.5);
  });
  it("says PASSED in the feedback", () => {
    expect(formatGateFeedback(report, { round: 1, maxRounds: 3 })).toMatch(/PASSED/);
  });
});

describe("each check catches its own defect (one change to the pristine page)", () => {
  const good = pristineDocument();
  const base = ids(good, { brief: crumb });
  const mutate = (from: string | RegExp, to: string) => good.replace(from, to);
  const must = (html: string, id: string, extra: Partial<Parameters<typeof checkPage>[0]> = {}) => {
    const f = checkPage({ html, brief: crumb, ...extra }).findings.find((x) => x.id === id);
    expect(f, id).toBeTruthy();
    return f!;
  };
  it("pristine has none of these", () => expect(base.filter((i) => ["placeholder", "h1-missing", "link-dead", "img-alt-missing"].includes(i))).toEqual([]));
  it("lorem ipsum and 'Welcome to our website'", () => {
    must(mutate("Fresh from our oven to your Saturday", "Welcome to our website"), "placeholder");
    must(mutate("Order in three easy steps", "Lorem ipsum dolor sit amet"), "placeholder");
  });
  it("placeholder email and phone", () => {
    must(mutate("+233 24 123 4567", "(555) 123-4567"), "placeholder");
    must(mutate("hello@crumbandco.com</a><a href=\"https", "you@example.com</a><a href=\"https"), "placeholder");
  });
  it("heading hierarchy", () => {
    must(mutate("Order in three easy steps", "Order in three easy steps").replace('<h2 class="h2">What we bake', '<h1>What we bake'), "h1-many");
    must(good.replace(/<h1[\s\S]*?<\/h1>/, ""), "h1-missing");
  });
  it("one primary CTA above the fold, and a final one", () => {
    must(mutate(/<a class="plx-btn cta-primary" href="#order">Order a cake for this weekend<\/a><a class="plx-btn cta-quiet" href="#menu">See what's baking<\/a>/, ""), "cta-hero");
    must(good.replace(/<section id="order"[\s\S]*?<\/section>/, "").replace(/<section id="faq"[\s\S]*?<\/section>/, "<section id=\"faq\"><h2>Q</h2><p>Plain answer with enough words in it.</p></section>"), "cta-final");
  });
  it("images: alt text, empty slots, placeholder sources", () => {
    must(mutate(' alt="A tray of warm sourdough loaves on a wooden counter"', ""), "img-alt-missing");
    must(mutate("</section>\n<section id=\"proof\"", "<div class=\"plx-ph\" role=\"img\" aria-label=\"\"></div></section>\n<section id=\"proof\""), "image-slot-empty");
    must(mutate("https://cdn.example/crumb-hero.jpg", "https://via.placeholder.com/800"), "img-broken");
  });
  it("links: dead, missing anchors, unknown pages, malformed contact links", () => {
    must(mutate('href="#menu"', 'href="#"'), "link-dead");
    must(mutate('href="#menu"', 'href="#nowhere"'), "link-anchor");
    must(mutate('href="/"', 'href="/pricing"'), "link-page", { knownRoutes: ["/", "/about"] });
    must(mutate("tel:+233241234567", "tel:12"), "link-contact");
  });
  it("forms need a destination and fields", () => {
    must(mutate(/action="[^"]*"/, 'action=""'), "form-destination");
    must(mutate('<button type="submit" class="plx-btn cta-primary">Send my order</button>', ""), "form-incomplete");
  });
  it("title, description, social fields", () => {
    must(mutate(/<title>[^<]*<\/title>/, "<title>Home</title>"), "seo-title");
    must(mutate(/<meta name="description"[^>]*>/, ""), "seo-description");
    must(mutate(/<meta property="og:image"[^>]*>/, ""), "og-image");
  });
  it("the owner's brand is applied: colour, name, spelling, fonts", () => {
    must(mutate(/#C2410C/g, "#0F766E"), "brand-colour");
    must(good.replace(/Crumb &amp; Co/g, "Acme"), "brand-name");
    must(mutate("Crumb &amp; Co, 14 Oxford", "Crumb and Co, 14 Oxford").replace(/Crumb &amp; Co/g, "Crumb and Co"), "brand-name-spelling", { brief: parseBrief({ text: "Landing page for Crumb & Co." }) });
    expect(ids(mutate(/Fraunces/g, "Georgia"), { brief: crumb })).toContain("brand-fonts");
  });
  it("the owner's uploaded logo must be in the header", () => {
    const withLogo = parseBrief({ text: "Landing page for Crumb & Co", attachments: [{ type: "image", filename: "logo.png" }] });
    must(good, "brand-logo", { brief: withLogo });
    expect(ids(good.replace('<section id="header-menu" class="hdr">', '<section id="header-menu" class="hdr"><img src="https://cdn.example/logo.png" alt="Crumb &amp; Co logo">'), { brief: withLogo })).not.toContain("brand-logo");
  });
  it("copy quality: repeats, generic filler, filler headings", () => {
    expect(ids(mutate("Two days ahead is perfect. Need it sooner? Message us and we will try.", "Every cake is baked the morning it is delivered."), { brief: crumb })).toContain("copy-repeat");
    expect(ids(mutate("Slow-fermented for 24 hours", "We offer high-quality, world-class bread"), { brief: crumb })).toContain("copy-generic");
    must(mutate("Pick your bake", "Feature 1"), "placeholder");
  });
  it("mobile: fixed widths, tiny text, short tap targets", () => {
    expect(ids(mutate(".s{", ".wide{width:900px}.s{"), { brief: crumb })).toContain("mobile-fixed-width");
    expect(ids(mutate(".s{", ".tiny{font-size:10px}.s{"), { brief: crumb })).toContain("mobile-small-text");
    expect(ids(mutate("padding:14px 24px;font-size:16px", "padding:4px 8px;font-size:14px"), { brief: crumb })).toContain("mobile-tap-target");
  });
  it("weight: an enormous page is a must-fix", () => {
    must(mutate("</body>", `<!-- ${"x".repeat(950_000)} --><p>${"y".repeat(10)}</p></body>`), "weight");
  });
  it("reading level is measured", () => {
    expect(readingGrade("The cat sat on the mat. ".repeat(12))).toBeLessThan(3);
    expect(readingGrade("Notwithstanding considerable organisational heterogeneity, multidisciplinary stakeholders operationalise comprehensive methodological frameworks. ".repeat(4))).toBeGreaterThan(14);
  });
});
