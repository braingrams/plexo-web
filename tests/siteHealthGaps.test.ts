import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// In-memory stand-ins for every table the closed gaps touch.
const h = vi.hoisted(() => ({
  settings: new Map<string, Record<string, any>>(),
  dims: new Map<string, Record<string, any>>(),
  queue: new Map<string, Record<string, any>>(),
  checks: new Map<string, Record<string, any>[]>(),
  templates: new Map<string, Record<string, any>>(),
  domains: [] as Record<string, any>[],
  products: [] as Record<string, any>[],
  generate: vi.fn(),
  charged: [] as unknown[],
  credits: { available: 1000 },
  runCheck: vi.fn(),
  fetchImpl: null as null | ((url: string) => Promise<Response>),
}));

vi.mock("@/lib/db/opsEntities", () => {
  const settings = {
    get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.settings.get(templateId) ?? null }) }),
    upsert: (item: { templateId: string }) => ({ go: async () => void h.settings.set(item.templateId, { ...(h.settings.get(item.templateId) ?? {}), ...item }) }),
    patch: ({ templateId }: { templateId: string }) => ({ remove: (keys: string[]) => ({ go: async () => void keys.forEach((k) => delete h.settings.get(templateId)?.[k]) }) }),
  };
  const ImageDimension = {
    get: (keys: { key: string }[]) => ({ go: async () => ({ data: keys.map((k) => h.dims.get(k.key)).filter(Boolean) }) }),
    upsert: (item: { key: string }) => ({ go: async () => void h.dims.set(item.key, { ...item, checkedAt: new Date().toISOString() }) }),
  };
  const SiteHealthRecheck = {
    get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.queue.get(templateId) ?? null }) }),
    upsert: (item: { templateId: string }) => ({ go: async () => void h.queue.set(item.templateId, { ...item }) }),
    delete: ({ templateId }: { templateId: string }) => ({ go: async () => void h.queue.delete(templateId) }),
    patch: ({ templateId }: { templateId: string }) => ({ set: (v: Record<string, unknown>) => ({ go: async () => void Object.assign(h.queue.get(templateId) ?? {}, v) }) }),
    query: { primary: () => ({ go: async () => ({ data: [...h.queue.values()] }) }) },
  };
  const SiteHealthCheck = {
    query: { primary: ({ templateId }: { templateId: string }) => ({ go: async ({ limit }: { limit?: number } = {}) => ({ data: [...(h.checks.get(templateId) ?? [])].reverse().slice(0, limit ?? 99) }) }) },
  };
  return { SiteHealthSettings: settings, ImageDimension, SiteHealthRecheck, SiteHealthCheck, SiteGoogleAnalytics: {} };
});
vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.templates.get(id) ?? null }) }),
    query: { byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.parentId === parentId) }) }) },
  },
  PublishedDomain: { scan: { where: () => ({ go: async () => ({ data: h.domains, cursor: null }) }) } },
}));
vi.mock("@/lib/db/commerceEntities", () => ({
  CommerceProduct: { query: { primary: () => ({ go: async () => ({ data: h.products }) }) } },
  CommerceSettings: { get: () => ({ go: async () => ({ data: { pickupLocation: "12 Allen Avenue, Ikeja" } }) }) },
  CommerceAvailabilityRule: { query: { byProduct: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/brand/resolveSiteBrand", () => ({ tryResolveSiteBrand: async () => ({ logoUrl: "https://cdn.test/logo.png" }) }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true }));
vi.mock("@/lib/ai/providers/bedrockClaude", () => ({ generate: (...a: unknown[]) => h.generate(...a) }));
vi.mock("@/lib/ai/modelRegistry", () => ({ resolveModel: () => "m" }));
vi.mock("@/lib/db/ledgerOperations", () => ({
  chargeUsage: async (_u: string, p: unknown) => (h.charged.push(p), { creditsCharged: 2 }),
  ensureCreditPeriod: async () => h.credits,
  estimateWorstCaseCost: () => 10,
}));
vi.mock("@/lib/siteImport/fetchSafe", () => ({
  safeFetch: async (url: string) => {
    if (!h.fetchImpl) throw new Error("no network in tests");
    return h.fetchImpl(url);
  },
}));
vi.mock("@/lib/pub/edgeCache", () => ({ purgeSitePages: async () => ({ cleared: 0 }) }));
vi.mock("@/lib/siteHealth/service", () => ({ runSiteCheck: (...a: unknown[]) => h.runCheck(...a), WEEKLY_MS: 7 * 24 * 60 * 60 * 1000 }));

import { hasBothSizes, imageKey, imagesNeedingSize, learnSizes, originalImageUrl, probeImageSize, readImageSize, sizesFor } from "@/lib/siteHealth/imageSize";
import { imageSizes } from "@/lib/siteHealth/speedFixes";
import { applyHealthSettings, applyHealthSettingsWithNotes, NO_SETTINGS, toView } from "@/lib/siteHealth/serve";
import { cleanBusiness, detectFromHtml, effectiveKind, hoursFromRules, missingDetails, organizationJsonLd, productJsonLd } from "@/lib/siteHealth/businessMarkup";
import { gatherBusinessDraft } from "@/lib/siteHealth/business";
import { MAX_PICTURES, pagesWithoutTitle, picturesWithoutDescription, writePictureDescriptions, writeTitles } from "@/lib/siteHealth/aiText";
import { previewFix, setAutoFix } from "@/lib/siteHealth/fixes";
import { dueForWeekly, processRecheckQueue, queueRecheck, RECHECK_DELAY_MS, sweepWeekly } from "@/lib/siteHealth/recheck";
import { autoStatus } from "@/lib/siteHealth/service-status";
import { editorQueriesFor, findDesignNodeId, findSourceLine, findTextField, firstUndescribedPicture, tokensOf } from "@/lib/siteHealth/editorLinks";
import { withEditorLinks } from "@/lib/siteHealth/present";
import { buildIssues } from "@/lib/siteHealth/explain";
import { focusElementWhenReady } from "@/app/dashboard/templates/[id]/focusElement";

// ── tiny real files ─────────────────────────────────────────────────────────
const png = (w: number, hgt: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(hgt, 20);
  return b;
};
const jpeg = (w: number, hgt: number, orientation?: number) => {
  const parts: number[] = [0xff, 0xd8];
  if (orientation) {
    // APP1 with a minimal little-endian EXIF block holding the orientation tag.
    const tiff = Buffer.alloc(26);
    tiff.write("II", 0, "latin1");
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x0112, 10);
    tiff.writeUInt16LE(3, 12);
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt16LE(orientation, 18);
    const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
    parts.push(0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255, ...exif);
  }
  parts.push(0xff, 0xc0, 0, 17, 8, hgt >> 8, hgt & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  return Buffer.from(parts);
};
const gif = (w: number, hgt: number) => {
  const b = Buffer.alloc(13);
  b.write("GIF89a", 0, "latin1");
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(hgt, 8);
  return b;
};
const webpX = (w: number, hgt: number) => {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1");
  b.write("WEBP", 8, "latin1");
  b.write("VP8X", 12, "latin1");
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(hgt - 1, 27, 3);
  return b;
};

beforeEach(() => {
  for (const m of [h.settings, h.dims, h.queue, h.checks, h.templates]) m.clear();
  h.domains = [];
  h.products = [];
  h.generate.mockReset();
  h.runCheck.mockReset();
  h.charged.length = 0;
  h.credits.available = 1000;
  h.fetchImpl = null;
});

// ════════════════════════════════════════════════════════════════════════════
describe("2. Picture sizes", () => {
  it("reads the size from real PNG, JPEG, GIF, WebP and SVG headers", () => {
    expect(readImageSize(png(800, 600))).toEqual({ width: 800, height: 600 });
    expect(readImageSize(jpeg(1200, 900))).toEqual({ width: 1200, height: 900 });
    expect(readImageSize(gif(64, 32))).toEqual({ width: 64, height: 32 });
    expect(readImageSize(webpX(1600, 1066))).toEqual({ width: 1600, height: 1066 });
    expect(readImageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"></svg>'))).toEqual({ width: 120, height: 60 });
    expect(readImageSize(Buffer.from('<svg width="48px" height="24px"></svg>'))).toEqual({ width: 48, height: 24 });
  });
  it("swaps the sides of a phone photo that is stored turned on its side", () => {
    expect(readImageSize(jpeg(4000, 3000, 6))).toEqual({ width: 3000, height: 4000 });
    expect(readImageSize(jpeg(4000, 3000, 1))).toEqual({ width: 4000, height: 3000 });
  });
  it("says nothing for files it cannot read, or sizes that make no sense", () => {
    expect(readImageSize(Buffer.from("not a picture at all, just words"))).toBeNull();
    expect(readImageSize(png(0, 10))).toBeNull();
    expect(readImageSize(png(90000, 10))).toBeNull();
  });
  it("unwraps Plexo's resizer and refuses anything that is not a web address", () => {
    expect(originalImageUrl("/_next/image?url=https%3A%2F%2Fcdn.test%2Fa.jpg&w=1920&q=75", "https://site.test/")).toBe("https://cdn.test/a.jpg");
    expect(originalImageUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(originalImageUrl("javascript:alert(1)")).toBeNull();
    expect(originalImageUrl("/img/a.png", "https://site.test/")).toBe("https://site.test/img/a.png");
  });
  it("finds the pictures that need a size and skips the ones that have both", () => {
    const html = `<img src="https://cdn.test/a.jpg"><img src="https://cdn.test/b.jpg" width="10" height="10"><img src="data:image/gif;base64,R0">`;
    expect(imagesNeedingSize(html)).toEqual(["https://cdn.test/a.jpg"]);
    expect(hasBothSizes('src="x" width="10" height="5"')).toBe(true);
  });

  it("looks a picture up safely: reads only the start, and gives up on non-pictures and blocked addresses", async () => {
    let asked: RequestInit | undefined;
    const big = Buffer.concat([png(640, 480), Buffer.alloc(900_000)]);
    h.fetchImpl = async (u) => {
      if (u.includes("html")) return new Response("<html></html>", { headers: { "content-type": "text/html" } });
      return new Response(big, { headers: { "content-type": "image/png" } });
    };
    expect(await probeImageSize("https://other.test/a.png")).toEqual({ width: 640, height: 480 });
    expect(await probeImageSize("https://other.test/page.html")).toBeNull();
    h.fetchImpl = async () => {
      throw new Error("Blocked outbound request to http://169.254.169.254/: resolves to a non-public address");
    };
    expect(await probeImageSize("http://169.254.169.254/latest")).toBeNull();
    void asked;
  });
  it("remembers sizes, does not ask again, and does not retry a dead link for a week", async () => {
    let calls = 0;
    h.fetchImpl = async (u) => {
      calls++;
      return u.includes("dead") ? new Response("", { status: 404 }) : new Response(png(300, 200), { headers: { "content-type": "image/png" } });
    };
    const urls = ["https://other.test/ok.png", "https://other.test/dead.png"];
    expect(await learnSizes(urls)).toMatchObject({ known: 1, probed: 2, unreadable: 1 });
    expect(calls).toBe(2);
    expect((await sizesFor(urls)).get(urls[0])).toEqual({ width: 300, height: 200 });
    expect(h.dims.get(imageKey(urls[1]))?.failed).toBe(true);
    expect(await learnSizes(urls)).toMatchObject({ probed: 0 });
    expect(calls).toBe(2);
  });

  it("gives remembered sizes to the page, leaves others alone, and the page's own sizes win", () => {
    const sizes = new Map([["https://cdn.test/a.jpg", { width: 800, height: 600 }]]);
    const html = `<html><head></head><body><img src="https://cdn.test/a.jpg" class="hero"><img src="https://cdn.test/unknown.jpg"><img src="https://cdn.test/a.jpg" width="50" height="40"><img src="https://cdn.test/a.jpg" style="border:0"></body></html>`;
    const out = imageSizes(html, { canonicalUrl: "https://site.test/", siteName: "S", sizes });
    expect(out.html).toContain('<img width="800" height="600" data-plexo-sized src="https://cdn.test/a.jpg" class="hero" style="aspect-ratio:800/600">');
    expect(out.html).toContain('<img src="https://cdn.test/unknown.jpg">');
    expect(out.html).toContain('width="50" height="40">');
    expect(out.html).toContain('style="border:0;aspect-ratio:800/600"');
    // One small rule keeps the height in proportion; it has no weight of its own, so the owner's styles still win.
    expect(out.html.match(/<style data-plexo-sized>/g)).toHaveLength(1);
    expect(out.html).toContain(":where(img[data-plexo-sized]){height:auto}");
    expect(imageSizes(out.html, { canonicalUrl: "https://site.test/", siteName: "S", sizes }).notes).toEqual([]);
  });
  it("does nothing, and says nothing, when no size is known (no invented numbers)", () => {
    expect(imageSizes("<img src='a.png'>", { canonicalUrl: "https://s.test/", siteName: "S", sizes: new Map() })).toEqual({ html: "<img src='a.png'>", notes: [] });
  });
  it("is off until switched on, and switching it off restores the page exactly", () => {
    const html = `<html><head></head><body><img src="https://cdn.test/a.jpg"></body></html>`;
    const ctx = { canonicalUrl: "https://site.test/", siteName: "S", sizes: new Map([["https://cdn.test/a.jpg", { width: 10, height: 5 }]]) };
    expect(applyHealthSettings(html, NO_SETTINGS, ctx)).toBe(html);
    expect(applyHealthSettings(html, { ...NO_SETTINGS, extras: { image_sizes: true } }, ctx)).toContain('width="10" height="5"');
  });
  it("is offered as the fix for a jumpy page, and shown as done once on", () => {
    const issues = buildIssues({ speed: null, aeo: null, settings: { ...NO_SETTINGS, extras: { image_sizes: true } } });
    expect(issues.find((i) => i.id === "jumpy_page")).toMatchObject({ severity: "good", autoFix: { id: "image_sizes", on: true } });
  });
  it("switching it on measures the site's pictures once, and uploads record their own size", async () => {
    h.fetchImpl = async () => new Response(png(500, 250), { headers: { "content-type": "image/png" } });
    h.templates.set("s1", { id: "s1", name: "S", compiledHtml: `<img src="https://other.test/a.png">`, order: 0 });
    const site = { id: "s1", organizationId: "o1", name: "S", compiledHtml: `<img src="https://other.test/a.png">` };
    const r = await setAutoFix(site, "image_sizes", true);
    expect(r.ok && r.settings.extras.image_sizes).toBe(true);
    expect((await sizesFor(["https://other.test/a.png"])).size).toBe(1);
    const { recordUploadedSize } = await import("@/lib/siteHealth/imageSize");
    expect(await recordUploadedSize("https://bucket.s3.amazonaws.com/media/u/x.jpg", jpeg(2000, 1000))).toEqual({ width: 2000, height: 1000 });
    expect(h.dims.get(imageKey("https://bucket.s3.amazonaws.com/media/u/x.jpg"))).toMatchObject({ width: 2000, height: 1000, source: "upload" });
    // The upload routes record the size before they answer.
    for (const f of ["app/api/v1/media/upload/route.ts", "app/api/blog/[templateId]/upload-image/route.ts"]) expect(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).toContain("recordUploadedSize");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("3. Business and product markup from real data", () => {
  const page = `<html><body><a href="tel:+2348012345678">Call</a><a href="mailto:hi@mamatee.com?subject=x">Mail</a><a href="https://www.instagram.com/mamatee/">IG</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a><a href="https://facebook.com/mamatee">FB</a></body></html>`;
  it("reads phone, email and social profiles the owner already put on the page, but not share buttons", () => {
    expect(detectFromHtml(page)).toEqual({ phone: "+2348012345678", email: "hi@mamatee.com", sameAs: ["https://www.instagram.com/mamatee", "https://facebook.com/mamatee"] });
  });
  it("turns booking times into opening hours, grouping days that match", () => {
    expect(hoursFromRules([{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }, { dayOfWeek: 2, startMinute: 540, endMinute: 1020 }, { dayOfWeek: 6, startMinute: 600, endMinute: 780 }, { dayOfWeek: 1, startMinute: 600, endMinute: 900 }])).toEqual([
      { days: [1, 2], opens: "09:00", closes: "17:00" },
      { days: [6], opens: "10:00", closes: "13:00" },
    ]);
  });
  it("keeps only what is real: bad phone numbers, emails and non-https links are dropped", () => {
    const b = cleanBusiness({ name: "  Mama   Tee ", phone: "abc", email: "nope", logo: "http://x.test/l.png", sameAs: ["javascript:1", "https://x.test/me"], address: {}, evil: "<script>" });
    expect(b).toEqual({ name: "Mama Tee", sameAs: ["https://x.test/me"] });
  });
  it("builds a LocalBusiness only when it has a street and town, otherwise an honest Organization", () => {
    const full = cleanBusiness({ kind: "local", name: "Mama Tee Bakery", phone: "+234 801 234 5678", logo: "https://cdn.test/l.png", address: { street: "12 Allen Avenue", city: "Ikeja", country: "NG" }, hours: [{ days: [1, 2], opens: "09:00", closes: "17:00" }], sameAs: ["https://instagram.com/mamatee"] });
    const ld = organizationJsonLd(full, { siteName: "S", origin: "https://mamatee.com", description: "Fresh bread." });
    expect(ld).toMatchObject({ "@type": "LocalBusiness", name: "Mama Tee Bakery", telephone: "+234 801 234 5678", logo: "https://cdn.test/l.png", address: { streetAddress: "12 Allen Avenue", addressLocality: "Ikeja" }, openingHoursSpecification: [{ dayOfWeek: ["Monday", "Tuesday"], opens: "09:00", closes: "17:00" }] });
    const noAddress = cleanBusiness({ kind: "local", name: "Mama Tee" });
    expect(effectiveKind(noAddress)).toBe("Organization");
    expect(organizationJsonLd(noAddress, { siteName: "S", origin: "https://m.test" })).not.toHaveProperty("address");
  });
  it("asks only for what a local business still lacks, in plain words", () => {
    expect(missingDetails(cleanBusiness({ kind: "online", name: "X" }))).toEqual([]);
    expect(missingDetails(cleanBusiness({ kind: "local", name: "X" })).map((m) => m.field)).toEqual(["address", "phone"]);
  });
  it("gathers what Plexo already knows (name, logo, pickup address, page links) and lets the owner's stored values win", async () => {
    const draft = await gatherBusinessDraft({ id: "s1", organizationId: "o1", name: "Mama Tee Bakery", compiledHtml: page }, { phone: "0801 111 2222", name: "Mama Tee" });
    expect(draft.details).toMatchObject({ name: "Mama Tee", logo: "https://cdn.test/logo.png", phone: "0801 111 2222", email: "hi@mamatee.com", kind: "local", address: { street: "12 Allen Avenue", city: "Ikeja" } });
    expect(draft.found).toEqual(expect.arrayContaining(["your logo", "your pickup address", "your social profiles"]));
    expect(draft.missing).toEqual([]);
  });
  it("shows the missing details as a form in the preview, and stores what the owner confirms", async () => {
    const site = { id: "s1", organizationId: "o1", name: "Mama Tee Bakery", compiledHtml: "<html><head></head><body><h1>Hi</h1></body></html>" };
    const p = await previewFix(site, "organization_schema", NO_SETTINGS, null);
    expect(p.business?.values.address?.street).toBe("12 Allen Avenue");
    expect(p.business?.missing.map((m) => m.field)).toEqual(["phone"]);
    const res = await setAutoFix(site, "organization_schema", true, { business: { ...p.business!.values, phone: "+2348012345678" } });
    expect(res.ok && res.settings.business).toMatchObject({ phone: "+2348012345678", address: { city: "Ikeja" } });
    const served = applyHealthSettings(site.compiledHtml, (res as any).settings, { canonicalUrl: "https://mamatee.com/", siteName: "Mama Tee Bakery" });
    expect(served).toContain('"@type":"LocalBusiness"');
    expect(served).toContain("12 Allen Avenue");
    // Undo: the page is as the owner built it; the confirmed details stay for next time.
    const off = await setAutoFix(site, "organization_schema", false);
    expect(applyHealthSettings(site.compiledHtml, (off as any).settings, { canonicalUrl: "https://mamatee.com/", siteName: "x" })).toBe(site.compiledHtml);
    expect((off as any).settings.business.phone).toBe("+2348012345678");
  });
  it("leaves a page that already has business markup alone", () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Organization"}</script></head><body></body></html>`;
    expect(applyHealthSettings(html, { ...NO_SETTINGS, organizationSchema: true }, { canonicalUrl: "https://a.test/", siteName: "A" })).toBe(html);
  });
  it("builds Product markup from the product's own price, picture and stock", () => {
    const ld = productJsonLd({ name: "Sourdough", description: "Fresh.", imageUrl: "https://cdn.test/s.jpg", sku: "SD1", priceMinor: 250000, currency: "ngn", stockQuantity: 0, kind: "PHYSICAL" }, { url: "https://mamatee.com/sourdough", seller: "Mama Tee" });
    expect(ld).toMatchObject({ "@type": "Product", name: "Sourdough", sku: "SD1", offers: { price: "2500.00", priceCurrency: "NGN", availability: "https://schema.org/OutOfStock" } });
    expect((productJsonLd({ name: "X", priceMinor: 100, stockQuantity: null }, { url: "u", seller: "s" }).offers as any).availability).toBe("https://schema.org/InStock");
  });
  it("offers product markup only to sites that sell products, and the pages use it only while it is on", async () => {
    expect(buildIssues({ speed: null, aeo: null, settings: NO_SETTINGS, facts: { productCount: 0 } }).some((i) => i.id === "product_schema")).toBe(false);
    expect(buildIssues({ speed: null, aeo: null, settings: NO_SETTINGS, facts: { productCount: 3 } }).find((i) => i.id === "product_schema")?.autoFix?.id).toBe("product_schema");
    const site = { id: "s1", organizationId: "o1", name: "S", compiledHtml: "<html><head></head><body></body></html>" };
    expect((await previewFix(site, "product_schema", NO_SETTINGS, null)).error).toMatch(/no products/i);
    h.products = [{ id: "p1", active: true, kind: "PHYSICAL" }];
    expect((await previewFix(site, "product_schema", NO_SETTINGS, null)).notes[0]).toMatch(/1 product page tells Google its price/);
    const route = readFileSync(new URL("../app/pub/[domain]/[[...slug]]/route.ts", import.meta.url), "utf8");
    expect(route).toContain("extras.product_schema");
    expect(route).toContain("productJsonLd(");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("4. Titles and picture descriptions written once", () => {
  const pages = [
    { id: "s1", path: "/", name: "Home", html: "<html><head><title>Mama Tee Bakery</title></head><body><h1>Bread</h1><img src='https://cdn.test/a.jpg'></body></html>" },
    { id: "p2", path: "/about", name: "About", html: "<html><head></head><body><h1>Our story</h1><p>We bake in Lagos.</p></body></html>" },
    { id: "p3", path: "/menu", name: "Menu", html: "<html><head><title></title></head><body><h1>Menu</h1><img src='https://cdn.test/b.jpg' alt=''><img src='https://cdn.test/c.jpg' alt='A loaf'></body></html>" },
  ];
  it("finds the pages with no title and the pictures with no description", () => {
    expect(pagesWithoutTitle(pages).map((p) => p.path)).toEqual(["/about", "/menu"]);
    expect(picturesWithoutDescription(pages, "https://s.test/").map((p) => p.url)).toEqual(["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"]);
  });
  it("writes the titles with one call, bills the real usage once, and keeps them short", async () => {
    h.generate.mockResolvedValue({ text: "1. About Mama Tee Bakery | Mama Tee\n2. " + "Our bread menu ".repeat(10), usage: { inputTokens: 300, outputTokens: 40 } });
    const r = await writeTitles("u1", "Mama Tee", pages);
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(r.ok && r.texts["/about"]).toBe("About Mama Tee Bakery | Mama Tee");
    expect(r.ok && r.texts["/menu"]!.length).toBeLessThanOrEqual(65);
    expect(h.charged).toEqual([{ provider: "bedrock_claude", tier: "BASIC", mode: "edit_element", usage: { inputTokens: 300, outputTokens: 40 } }]);
  });
  it("does not call the model or charge anything when the account cannot afford it", async () => {
    h.credits.available = 1;
    const r = await writeTitles("u1", "Mama Tee", pages);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/enough credits/);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.charged).toEqual([]);
  });
  it("describes pictures by looking at them, skips ones it cannot open, and never writes more than the cap in one go", async () => {
    h.fetchImpl = async (u) => (u.includes("bad") ? new Response("", { status: 404 }) : new Response(jpeg(10, 10), { headers: { "content-type": "image/jpeg" } }));
    h.generate.mockResolvedValue({ text: "A golden loaf on a wooden board", usage: { inputTokens: 1600, outputTokens: 12 } });
    const many = Array.from({ length: MAX_PICTURES + 5 }, (_, i) => ({ url: `https://cdn.test/${i === 1 ? "bad" : i}.jpg`, page: "Home" }));
    const r = await writePictureDescriptions("u1", "Mama Tee", many);
    expect(r.ok && r.capped).toBe(true);
    expect(h.generate).toHaveBeenCalledTimes(MAX_PICTURES - 1);
    expect(r.ok && r.skipped).toHaveLength(1);
    expect(h.charged).toHaveLength(1);
    expect((h.generate.mock.calls[0][0] as any).attachments[0].mediaType).toBe("image/jpeg");
  });
  it("drops 'picture of' lead-ins and decorative pictures", async () => {
    h.fetchImpl = async () => new Response(jpeg(10, 10), { headers: { "content-type": "image/jpeg" } });
    h.generate.mockResolvedValueOnce({ text: "Picture of a chocolate cake on a stand", usage: {} }).mockResolvedValueOnce({ text: "DECORATIVE", usage: {} });
    const r = await writePictureDescriptions("u1", "S", [{ url: "https://cdn.test/1.jpg", page: "A" }, { url: "https://cdn.test/2.jpg", page: "B" }]);
    expect(r.ok && r.texts).toEqual({ "https://cdn.test/1.jpg": "a chocolate cake on a stand" });
  });

  const site = { id: "s1", organizationId: "o1", name: "Mama Tee", compiledHtml: pages[1].html, userId: "u1" };
  beforeEach(() => {
    for (const p of pages) h.templates.set(p.id, { id: p.id, name: p.name, compiledHtml: p.html, order: 0, ...(p.id === "s1" ? {} : { parentId: "s1", slug: p.path.slice(1) }) });
  });
  it("writes once at preview, stores it, and a second look costs nothing", async () => {
    h.generate.mockResolvedValue({ text: "1. About us | Mama Tee\n2. The menu | Mama Tee", usage: { inputTokens: 100, outputTokens: 20 } });
    const first = await previewFix(site, "page_title", NO_SETTINGS, null);
    expect(first.texts?.items.map((i) => i.text)).toEqual(["About us | Mama Tee", "The menu | Mama Tee"]);
    expect(h.generate).toHaveBeenCalledTimes(1);
    const second = await previewFix(site, "page_title", toView(h.settings.get("s1")), null);
    expect(second.texts?.items).toHaveLength(2);
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.charged).toHaveLength(1);
  });
  it("Regenerate writes them again, and only then", async () => {
    h.generate.mockResolvedValue({ text: "1. First try | Mama Tee\n2. First menu | Mama Tee", usage: {} });
    await previewFix(site, "page_title", NO_SETTINGS, null);
    h.generate.mockResolvedValue({ text: "1. Second try | Mama Tee\n2. Second menu | Mama Tee", usage: {} });
    const again = await previewFix(site, "page_title", toView(h.settings.get("s1")), null, { regenerate: true });
    expect(again.texts?.items[0].text).toBe("Second try | Mama Tee");
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("serves what the owner edited, never generates on a visit, and Undo restores the page byte for byte", async () => {
    h.generate.mockResolvedValue({ text: "1. About us | Mama Tee\n2. The menu | Mama Tee", usage: {} });
    await previewFix(site, "page_title", NO_SETTINGS, null);
    const on = await setAutoFix(site, "page_title", true, { titles: { "/about": "Our story | Mama Tee Bakery" } });
    expect(on.ok).toBe(true);
    const calls = h.generate.mock.calls.length;
    const view = (on as any).settings;
    const served = applyHealthSettings(pages[1].html, view, { canonicalUrl: "https://mamatee.com/about", siteName: "Mama Tee" });
    expect(served).toContain("<title>Our story | Mama Tee Bakery</title>");
    expect(h.generate.mock.calls.length).toBe(calls);
    // A page with a title of its own is untouched.
    expect(applyHealthSettings(pages[0].html, view, { canonicalUrl: "https://mamatee.com/", siteName: "Mama Tee" })).toBe(pages[0].html);
    const off = await setAutoFix(site, "page_title", false);
    expect(applyHealthSettings(pages[1].html, (off as any).settings, { canonicalUrl: "https://mamatee.com/about", siteName: "Mama Tee" })).toBe(pages[1].html);
  });
  it("serves stored picture descriptions first, then file-name ones, and never over the owner's own", () => {
    const html = `<img src="/_next/image?url=https%3A%2F%2Fcdn.test%2Fa.jpg&w=1920&q=75"><img src="https://cdn.test/sourdough-loaf.jpg"><img src="https://cdn.test/x.jpg" alt="Mine">`;
    const view = { ...NO_SETTINGS, altFromFilename: true, aiAlts: { "https://cdn.test/a.jpg": "A golden loaf on a board" } };
    const out = applyHealthSettings(html, view, { canonicalUrl: "https://mamatee.com/", siteName: "S" });
    expect(out).toContain('alt="A golden loaf on a board"');
    expect(out).toContain('alt="Sourdough loaf"');
    expect(out).toContain('alt="Mine"');
  });
  it("works without AI: with no account to bill, titles and descriptions fall back to the page's own words and file names", async () => {
    const r = await setAutoFix({ ...site, userId: undefined }, "page_title", true);
    expect(r.ok).toBe(true);
    expect(h.generate).not.toHaveBeenCalled();
    const served = applyHealthSettings(pages[1].html, (r as any).settings, { canonicalUrl: "https://mamatee.com/about", siteName: "Mama Tee" });
    expect(served).toContain("<title>Our story | Mama Tee</title>");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("5. Background re-checks", () => {
  const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
  const live = (id: string, org = "o1") => h.templates.set(id, { id, organizationId: org, kind: "LANDING_PAGE", name: id });

  it("queues a re-check a quarter of an hour after a change, and each new change pushes it back (one check for a burst of edits)", async () => {
    h.checks.set("s1", [{ createdAt: "2026-11-01T00:00:00.000Z" }]);
    await queueRecheck("s1", "changed", NOW);
    expect(h.queue.get("s1")!.dueAt).toBe(new Date(NOW + RECHECK_DELAY_MS).toISOString());
    await queueRecheck("s1", "changed", NOW + 5 * 60_000);
    expect(h.queue.size).toBe(1);
    expect(h.queue.get("s1")!.dueAt).toBe(new Date(NOW + 5 * 60_000 + RECHECK_DELAY_MS).toISOString());
  });
  it("does not queue changes for a site whose owner never used Site health (the weekly turn covers it)", async () => {
    await queueRecheck("s2", "changed", NOW);
    expect(h.queue.size).toBe(0);
    await queueRecheck("s2", "weekly", NOW);
    expect(h.queue.get("s2")).toMatchObject({ reason: "weekly" });
  });
  it("runs only what is due, in order, marks the check as automatic, and clears the entry", async () => {
    live("a");
    live("b");
    live("c");
    h.queue.set("a", { templateId: "a", reason: "changed", dueAt: new Date(NOW - 60_000).toISOString() });
    h.queue.set("b", { templateId: "b", reason: "weekly", dueAt: new Date(NOW - 120_000).toISOString() });
    h.queue.set("c", { templateId: "c", reason: "changed", dueAt: new Date(NOW + 600_000).toISOString() });
    h.runCheck.mockResolvedValue({ ok: true, cached: false, status: {} });
    const out = await processRecheckQueue({ now: NOW, budgetMs: 120_000 });
    expect(out).toMatchObject({ ran: 2, waiting: 1, failed: 0 });
    expect(h.runCheck.mock.calls.map((c) => [c[0].id, c[1]])).toEqual([["b", { scheduled: "weekly" }], ["a", { scheduled: "changed" }]]);
    expect([...h.queue.keys()]).toEqual(["c"]);
  });
  it("keeps a site queued and tries later when a limit stops it, and gives up after a few tries", async () => {
    live("a");
    h.queue.set("a", { templateId: "a", reason: "changed", dueAt: new Date(NOW - 1).toISOString(), attempts: 0 });
    h.runCheck.mockResolvedValue({ ok: false, status: 429, error: "limit" });
    expect(await processRecheckQueue({ now: NOW, budgetMs: 120_000 })).toMatchObject({ failed: 1 });
    expect(h.queue.get("a")).toMatchObject({ attempts: 1, dueAt: new Date(NOW + 3_600_000).toISOString() });
    h.queue.get("a")!.attempts = 3;
    h.queue.get("a")!.dueAt = new Date(NOW - 1).toISOString();
    await processRecheckQueue({ now: NOW, budgetMs: 120_000 });
    expect(h.queue.has("a")).toBe(false);
  });
  it("forgets sites that were deleted or are not live, and respects the time budget", async () => {
    h.queue.set("gone", { templateId: "gone", reason: "changed", dueAt: new Date(NOW - 1).toISOString() });
    live("notlive");
    h.queue.set("notlive", { templateId: "notlive", reason: "changed", dueAt: new Date(NOW - 1).toISOString() });
    h.runCheck.mockResolvedValue({ ok: false, status: 409, error: "not live" });
    const out = await processRecheckQueue({ now: NOW, budgetMs: 120_000 });
    expect(out.skipped).toBe(2);
    expect(h.queue.size).toBe(0);
    h.queue.set("late", { templateId: "late", reason: "changed", dueAt: new Date(NOW - 1).toISOString() });
    live("late");
    const tight = await processRecheckQueue({ now: NOW, budgetMs: 10_000 });
    expect(tight.stoppedEarly).toBe(true);
    expect(h.runCheck).toHaveBeenCalledTimes(1);
  });
  it("the weekly sweep queues only live sites last checked over a week ago (or never), and does not queue twice", async () => {
    h.domains = [{ templateId: "fresh" }, { templateId: "old" }, { templateId: "never" }, { templateId: "paused", planDisabledAt: "x" }, { templateId: "queued" }];
    h.checks.set("fresh", [{ createdAt: new Date(NOW - 2 * 86_400_000).toISOString() }]);
    h.checks.set("old", [{ createdAt: new Date(NOW - 9 * 86_400_000).toISOString() }]);
    h.queue.set("queued", { templateId: "queued", reason: "weekly", dueAt: "x" });
    const r = await sweepWeekly({ now: NOW });
    expect(r.queued).toBe(2);
    expect([...h.queue.keys()].sort()).toEqual(["never", "old", "queued"]);
    expect(dueForWeekly([{ id: "a", lastCheckAt: null }, { id: "b", lastCheckAt: new Date(NOW - 6 * 86_400_000).toISOString() }], NOW)).toEqual(["a"]);
    h.domains = Array.from({ length: 50 }, (_, i) => ({ templateId: `n${i}` }));
    h.queue.clear();
    expect((await sweepWeekly({ now: NOW, max: 7 })).queued).toBe(7);
  });
  it("tells the owner what happens next: a queued check, or the weekly turn, and when one last ran by itself", () => {
    const rows = [{ createdAt: "2026-11-18T10:00:00.000Z", report: { auto: "weekly" } }, { createdAt: "2026-11-10T10:00:00.000Z", report: {} }];
    expect(autoStatus(rows, { dueAt: "2026-11-19T12:15:00.000Z", reason: "changed" })).toEqual({ lastAt: "2026-11-18T10:00:00.000Z", nextAt: "2026-11-19T12:15:00.000Z", reason: "changed" });
    expect(autoStatus(rows, null)).toEqual({ lastAt: "2026-11-18T10:00:00.000Z", nextAt: "2026-11-25T10:00:00.000Z", reason: "weekly" });
    expect(autoStatus([], null)).toEqual({ lastAt: null, nextAt: null, reason: null });
  });
  it("is wired: the schedule, both routes' authentication and the retry lock, and the cost limits", () => {
    const stack = readFileSync(new URL("../cdk/lib/published-sites-stack.ts", import.meta.url), "utf8");
    expect(stack).toContain('scheduledRoute("SiteHealthRecheck", "/api/internal/site-health/recheck"');
    expect(stack).toContain('scheduledRoute("SiteHealthSweep", "/api/internal/site-health/sweep"');
    for (const r of ["recheck", "sweep"]) {
      const src = readFileSync(new URL(`../app/api/internal/site-health/${r}/route.ts`, import.meta.url), "utf8");
      expect(src).toContain("isCronRequest(request)");
      expect(src).toContain("status: 401");
      expect(src).toContain("takeJobLock");
    }
    const service = readFileSync(new URL("../lib/siteHealth/service.ts", import.meta.url), "utf8");
    expect(service).toContain("sitehealth:global:auto");
    expect(service).toContain("sitehealth:orgauto:");
    const hook = readFileSync(new URL("../lib/siteLayoutCore.ts", import.meta.url), "utf8");
    expect(hook).toContain("afterSiteChanged(templateId)");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("6. Open the editor at the exact element", () => {
  const v2 = { format: "plexo-v2@1", pages: [{ id: "pg", rootNode: { id: "root", type: "page", children: [{ id: "hero", type: "section", children: [{ id: "h-img", type: "image", props: { src: "https://cdn.test/hero.jpg", alt: "" } }, { id: "h-title", type: "heading", props: { text: "Fresh bread every morning", level: 4 } }, { id: "h-link", type: "button", props: { label: "Order now", href: "/order" } }] }] } }] };
  const raw = `<html>\n<body>\n<h2>Our bakery</h2>\n<p>We bake fresh bread every single morning.</p>\n<img src="https://cdn.test/loaf.jpg">\n<a href="/order">Order now</a>\n</body>\n</html>`;

  it("reads what to look for out of the element Google pointed at", () => {
    expect(tokensOf({ selector: "img", snippet: '<img src="/_next/image?url=https%3A%2F%2Fcdn.test%2Fhero.jpg&w=1920&q=75" class="x">', label: "" })).toMatchObject({ src: "https://cdn.test/hero.jpg" });
    expect(tokensOf({ selector: "h4", snippet: "<h4 class=\"t\">Fresh bread every morning</h4>", label: "" })).toMatchObject({ text: "Fresh bread every morning" });
    expect(tokensOf({ selector: "a", snippet: '<a href="/order" class="btn">', label: "" })).toMatchObject({ href: "/order" });
  });
  it("finds the element's id in a design: picture, words and link", () => {
    expect(findDesignNodeId(v2, { src: "https://cdn.test/hero.jpg" })).toBe("h-img");
    expect(findDesignNodeId(v2, { text: "Fresh bread every morning" })).toBe("h-title");
    expect(findDesignNodeId(v2, { href: "/order" })).toBe("h-link");
    expect(findDesignNodeId(v2, { text: "Nothing like this anywhere" })).toBeNull();
  });
  it("finds the line in the code, and the field in the text view", () => {
    expect(findSourceLine(raw, { src: "https://cdn.test/loaf.jpg" })).toBe(5);
    expect(findSourceLine(raw, { text: "Our bakery" })).toBe(3);
    expect(findSourceLine(raw, { text: "missing words here" })).toBeNull();
    expect(findTextField(raw, { src: "https://cdn.test/loaf.jpg" })).toBe("img-0");
    expect(findTextField(raw, { text: "Our bakery" })).toMatch(/^text-\d+$/);
  });
  it("gives block pages a focus link, and HTML pages a text-view field plus a code line", () => {
    expect(editorQueriesFor({ html: "", design: v2 }, { selector: "img", snippet: '<img src="https://cdn.test/hero.jpg">', label: "" })).toEqual({ editor: "focus=h-img" });
    expect(editorQueriesFor({ sourceType: "RAW_UPLOAD", html: raw }, { selector: "img", snippet: '<img src="https://cdn.test/loaf.jpg">', label: "" })).toEqual({ editor: "mode=text&field=img-0", code: "mode=code&line=5" });
    expect(editorQueriesFor({ sourceType: "RAW_UPLOAD", html: raw }, { selector: "x", snippet: "<div class=\"nowhere\">", label: "" })).toEqual({});
  });
  it("adds the links to the problems shown, including pictures with no description that Google did not point at", () => {
    const issues = buildIssues({ speed: null, aeo: { score: 50, checks: [{ id: "alt_text", passed: false, label: "", why: "", fix: "", weight: 7 } as any] } as any, settings: NO_SETTINGS });
    const withLinks = withEditorLinks(issues, { sourceType: "RAW_UPLOAD", html: raw });
    const alt = withLinks.find((i) => i.id === "alt_text")!;
    expect(alt.where?.[0]).toMatchObject({ editor: "mode=text&field=img-0", code: "mode=code&line=5" });
    expect(firstUndescribedPicture(raw)?.snippet).toContain("loaf.jpg");
  });
  it("is wired into the editors: the page reads the parameters, Code jumps to the line, Text opens the field, the visual editor highlights", () => {
    const read = (f: string) => readFileSync(new URL(`../app/dashboard/templates/[id]/${f}`, import.meta.url), "utf8");
    const page = read("page.tsx");
    for (const needle of ["initialLine={initialLine}", "initialField={initialField}", "focusNodeId={focusNodeId}"]) expect(page).toContain(needle);
    expect(read("raw-file-editor.tsx")).toContain("setPendingJump(offset)");
    expect(read("RawTextContentEditor.tsx")).toContain("setActiveField({ kind, id })");
    expect(read("v2/V2TemplateEditor.tsx")).toContain("focusElementWhenReady");
    // The classic editor gets the same id through the SDK's focusNodeId prop.
    expect(read("template-editor-client.tsx")).toMatch(/focusNodeId \? \{ focusNodeId \}/);
    const tab = readFileSync(new URL("../app/dashboard/_v3/hub/HealthTab.tsx", import.meta.url), "utf8");
    expect(tab).toContain("withQuery(editHref");
  });
  it("scrolls to the element once it appears and highlights it, then tidies up", async () => {
    vi.useFakeTimers();
    const classes = new Set<string>();
    const el = { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) }, scrollIntoView: vi.fn() };
    const appended: unknown[] = [];
    const doc = { getElementById: () => null, head: { appendChild: vi.fn() }, body: { appendChild: (n: unknown) => appended.push(n) }, createElement: () => ({ setAttribute() {}, remove() {}, className: "", textContent: "" }) } as unknown as Document;
    let present = false;
    const stop = focusElementWhenReady(() => (present ? (el as unknown as Element) : null), { doc });
    expect(el.scrollIntoView).not.toHaveBeenCalled();
    present = true;
    await vi.advanceTimersByTimeAsync(300);
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(classes.has("plx-health-focus")).toBe(true);
    expect(appended).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6100);
    expect(classes.has("plx-health-focus")).toBe(false);
    stop();
    vi.useRealTimers();
  });
  it("quietly gives up when the element never shows up", async () => {
    vi.useFakeTimers();
    const doc = { getElementById: () => null, head: { appendChild: vi.fn() }, body: { appendChild: vi.fn() }, createElement: vi.fn() } as unknown as Document;
    focusElementWhenReady(() => null, { doc, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(doc.body.appendChild).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("the fixes are listed everywhere they must be", () => {
  it("the new fixes are in the shared list, the tool schema and the docs", () => {
    const tools = readFileSync(new URL("../lib/mcp/healthTools.ts", import.meta.url), "utf8");
    for (const id of ["image_sizes", "product_schema"]) expect(tools).toContain(id);
    expect(tools).toContain("business:");
    expect(tools).toContain("regenerate:");
    expect(toView({ extras: { image_sizes: true, product_schema: true } }).extras).toEqual({ image_sizes: true, product_schema: true });
    void applyHealthSettingsWithNotes;
  });
});
