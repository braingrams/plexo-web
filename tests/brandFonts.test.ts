import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/brand/siteBrand", () => ({ brandForServing: async () => null }));
import { FONTS, FONT_PAIRS, FONT_PRECONNECT_TAGS, cssFamily, findFont, fontPreviewHref, fontStylesheetHref, fontsImportHrefs, nearestWeight, pairsFor, searchFonts, suggestPartner } from "@/lib/fonts/catalogue";
import { addCustomFontVariant, customFontFaceCss, guessFontFromFile, isFontUrl, removeCustomFontFamily, sanitizeCustomFonts } from "@/lib/fonts/customFonts";
import { brandFontCss } from "@/lib/fonts/brandFontCss";
import { parseFavourites, toggleFavourite } from "@/lib/fonts/favourites";
import { planTokenChanges, brandFromDesignSystem } from "@/lib/brand/brandModel";
import { brandLinkTag } from "@/lib/brand/inject";

describe("font catalogue", () => {
  it("holds the real Google Fonts catalogue, most used first", () => {
    expect(FONTS.length).toBeGreaterThan(1500);
    expect(FONTS[0].rank).toBe(1);
    expect(findFont("inter")?.weights).toContain(700);
    expect(findFont("Nope Nope")).toBeUndefined();
    for (const f of FONTS) expect(f.weights.length).toBeGreaterThan(0);
  });
  it("searches by name (starts-with first) and filters by style", () => {
    const r = searchFonts({ query: "mono" });
    expect(r.length).toBeGreaterThan(5);
    expect(r[0].name.toLowerCase().startsWith("mono")).toBe(true);
    expect(r.some((f) => !f.name.toLowerCase().startsWith("mono"))).toBe(true);
    const hand = searchFonts({ kind: "handwriting", limit: 20 });
    expect(hand).toHaveLength(20);
    expect(hand.every((f) => f.kind === "handwriting")).toBe(true);
    expect(searchFonts({ kind: "mono" }).some((f) => f.name === "Roboto Mono")).toBe(true);
    expect(searchFonts({ query: "zzzzqq" })).toEqual([]);
  });
  it("filters to favourites only", () => {
    const r = searchFonts({ only: ["lora", "Inter"] });
    expect(r.map((f) => f.name).sort()).toEqual(["Inter", "Lora"]);
  });
  it("every recommended pair uses real fonts and the two roles differ", () => {
    for (const p of FONT_PAIRS) {
      expect(findFont(p.heading), p.heading).toBeTruthy();
      expect(findFont(p.body), p.body).toBeTruthy();
      expect(p.heading).not.toBe(p.body);
    }
    expect(pairsFor("inter").length).toBeGreaterThan(1);
    expect(suggestPartner("Playfair Display", "heading")).toBe("Source Sans 3");
    expect(suggestPartner("Inter", "body")).toBe("Poppins");
    expect(suggestPartner("Nope", "body")).toBeNull();
    expect(findFont(suggestPartner("Roboto", "heading")!)).toBeTruthy();
  });
  it("only ever asks Google for weights a family really has", () => {
    const abril = findFont("Abril Fatface")!;
    expect(nearestWeight("Abril Fatface", 700)).toBe(abril.weights[0]);
    expect(fontStylesheetHref("Abril Fatface", [400, 700])).toBe("https://fonts.googleapis.com/css2?family=Abril+Fatface&display=swap");
    expect(fontStylesheetHref("Inter", [400, 700])).toContain("family=Inter:wght@400;700");
    expect(fontStylesheetHref("Not A Font")).toBeNull();
    expect(fontPreviewHref("Lora")).toContain("&text=Lora");
    const [href] = fontsImportHrefs([{ family: "Inter", weights: [400] }, { family: "inter" }, { family: "Lora", weights: [700] }, { family: "Unknown" }]);
    expect(href).toMatch(/family=Inter:wght@400/);
    expect(href).toMatch(/family=Lora:wght@700/);
    expect(href).toMatch(/display=swap$/);
    expect(href.match(/family=Inter/g)).toHaveLength(1);
  });
  it("quotes names and picks a sensible fallback", () => {
    expect(cssFamily("Lora")).toMatch(/^"Lora", ui-serif/);
    expect(cssFamily("Pacifico")).toMatch(/cursive$/);
  });
});

describe("favourites", () => {
  it("toggles, de-duplicates and ignores junk", () => {
    expect(toggleFavourite(["A"], "B")).toEqual(["B", "A"]);
    expect(toggleFavourite(["A", "B"], "A")).toEqual(["B"]);
    expect(parseFavourites('["Lora","Lora","<b>",5]')).toEqual(["Lora"]);
    expect(parseFavourites("not json")).toEqual([]);
  });
});

describe("uploaded fonts", () => {
  const v = { weight: 700, style: "normal" as const, url: "https://cdn.example.com/f.woff2", format: "woff2" as const };
  it("only keeps safe, complete fonts", () => {
    expect(sanitizeCustomFonts([{ family: "Brandon", variants: [v] }, { family: "Arial", variants: [v] }, { family: "Bad<>", variants: [v] }, { family: "NoFile", variants: [{ ...v, url: "javascript:alert(1)" }] }])).toEqual([{ family: "Brandon", variants: [v] }]);
    expect(isFontUrl('https://x.com/a"b')).toBe(false);
    expect(isFontUrl("//evil.com/a.woff")).toBe(false);
    expect(isFontUrl("/fonts/a.woff2")).toBe(true);
  });
  it("adds looks to one family and removes it", () => {
    const one = addCustomFontVariant(undefined, "Brandon", v);
    const two = addCustomFontVariant(one, "brandon", { ...v, weight: 400 });
    expect(two).toHaveLength(1);
    expect(two[0].variants.map((x) => x.weight).sort()).toEqual([400, 700]);
    expect(removeCustomFontFamily(two, "BRANDON")).toEqual([]);
  });
  it("writes @font-face with font-display: swap", () => {
    expect(customFontFaceCss([{ family: "Brandon", variants: [v] }])).toBe('@font-face{font-family:"Brandon";font-style:normal;font-weight:700;font-display:swap;src:url("https://cdn.example.com/f.woff2") format("woff2")}');
  });
  it("guesses the name, weight and format from a file name", () => {
    expect(guessFontFromFile("Brandon-BoldItalic.woff2")).toEqual({ family: "Brandon", weight: 700, style: "italic", format: "woff2" });
    expect(guessFontFromFile("MyFont.ttf").format).toBe("truetype");
    expect(guessFontFromFile("notes.pdf").format).toBeNull();
  });
});

describe("fonts on the published site", () => {
  const tokens = [
    { key: "--font-family-heading", value: '"Playfair Display", serif', type: "font family" },
    { key: "--font-family-body", value: "var(--font-family-x)", type: "font family" },
    { key: "--font-family-x", value: "Brandon, sans-serif", type: "font family" },
    { key: "--font-weight-heading", value: "800", type: "font weight" },
  ];
  it("loads the chosen weights with swap, and the owner's own font from its file", () => {
    const css = brandFontCss(tokens, [{ family: "Brandon", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2", format: "woff2" }] }]);
    expect(css).toMatch(/^@import url\("https:\/\/fonts\.googleapis\.com\/css2\?family=Playfair\+Display:wght@400;700;800&display=swap"\);/);
    expect(css).toContain('@font-face{font-family:"Brandon"');
    expect(css).not.toContain("family=Brandon");
  });
  it("adds nothing for system fonts", () => {
    expect(brandFontCss([{ key: "--font-family-body", value: "system-ui, sans-serif", type: "font family" }], undefined)).toBe("");
  });
  it("opens the font connections early on every page that links the brand", () => {
    expect(brandLinkTag("s1", "abc")).toContain(FONT_PRECONNECT_TAGS);
    expect(brandLinkTag("s1", "abc")).toContain('rel="preconnect" href="https://fonts.gstatic.com" crossorigin');
  });
});

describe("font weights in the brand", () => {
  it("become tokens, only valid weights, and are read back", () => {
    const plan = planTokenChanges([], { fontWeights: { heading: 700, body: "400" } });
    expect(plan.sent).toEqual(["heading font weight", "body font weight"]);
    expect(planTokenChanges([], { fontWeights: { heading: 750 } }).skipped[0]).toMatch(/heading font weight/);
    const ds = { name: "B", tokens: plan.tokens as never };
    expect(brandFromDesignSystem(ds).fontWeights).toEqual({ heading: 700, body: 400 });
  });
});
