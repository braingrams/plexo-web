import { describe, expect, it } from "vitest";
import { injectAppSeo, normalizeSeo, SeoInputError } from "@/lib/projects/appSeo";

const page = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="/vite.svg"><title>Vite + React</title><meta name="description" content="old"></head><body><div id="root"></div></body></html>`;

describe("normalizeSeo", () => {
  it("takes the code out of a pasted verification meta tag", () => {
    const seo = normalizeSeo({ googleVerification: `<meta name="google-site-verification" content="abc123XYZ_-def" />`, bingVerification: "  0123456789ABCDEF  " });
    expect(seo).toEqual({ googleVerification: "abc123XYZ_-def", bingVerification: "0123456789ABCDEF" });
  });

  it("drops empty fields so they go back to the app's defaults", () => {
    expect(normalizeSeo({ title: "  ", description: "", imageUrl: "" })).toEqual({});
  });

  it("explains what's wrong in plain words", () => {
    expect(() => normalizeSeo({ imageUrl: "http://x.com/a.png" })).toThrow(SeoInputError);
    expect(() => normalizeSeo({ title: "x".repeat(71) })).toThrow(/70 characters/);
    expect(() => normalizeSeo({ googleVerification: "<script>" })).toThrow(/Google/);
  });
});

describe("injectAppSeo", () => {
  it("replaces the app's default title, description and icon", () => {
    const html = injectAppSeo(page, { title: "Acme & Co", description: "Best widgets", faviconUrl: "https://cdn.x/icon.png" }, "https://acme.com/");
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain("<title>Acme &amp; Co</title>");
    expect(html).not.toContain("Vite + React");
    expect(html).not.toContain(`content="old"`);
    expect(html).not.toContain("vite.svg");
    expect(html).toContain(`<meta property="og:description" content="Best widgets">`);
    expect(html).toContain(`<link rel="icon" href="https://cdn.x/icon.png">`);
    expect(html).toContain(`<meta property="og:url" content="https://acme.com/">`);
  });

  it("adds verification tags and a large sharing card", () => {
    const html = injectAppSeo(page, { imageUrl: "https://cdn.x/og.png", googleVerification: "g-code", bingVerification: "b-code" }, "https://acme.com/");
    expect(html).toContain(`<meta name="google-site-verification" content="g-code">`);
    expect(html).toContain(`<meta name="msvalidate.01" content="b-code">`);
    expect(html).toContain(`<meta name="twitter:card" content="summary_large_image">`);
    expect(html).toContain("Vite + React");
  });

  it("leaves the page alone when nothing is set", () => {
    expect(injectAppSeo(page, {}, "https://acme.com/")).toBe(page);
    expect(injectAppSeo(page, null, "https://acme.com/")).toBe(page);
  });

  it("escapes values", () => {
    const html = injectAppSeo(page, { description: `"><script>alert(1)</script>` }, "https://acme.com/");
    expect(html).not.toContain("<script>alert");
  });
});
