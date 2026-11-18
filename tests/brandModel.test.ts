import { describe, expect, it } from "vitest";
import {
  applyBriefDefaults, brandForClient, brandFromDesignSystem, brandHexList, brandPromptBlock, knownBrandFromResolved, mergeBrand, parseBrandChoice, pickLogoAsset, primaryFontOf, strataPushTokens,
} from "@/lib/brand/brandModel";
import { AMA_DS, LINKED_AMA } from "./fixtures/strataBrandFixtures";

const OWN = { colors: ["#0F766E", "#134E4A"], logoUrl: "https://img.example.com/own-logo.png" };
const PROFILE = { name: "Ama", colors: ["#7C3AED"], logoUrl: "https://img.example.com/account-logo.png", tone: "warm and friendly", about: "Homemade meals" };

describe("brandFromDesignSystem", () => {
  const b = brandFromDesignSystem(AMA_DS);
  it("reads colours with their roles, following references", () => {
    expect(b.colours.map((c) => [c.role, c.value])).toEqual([
      ["primary", "#E4572E"], ["secondary", "#2B2D42"], ["accent", "#F4A261"], ["text", "#1B1B1F"], ["background", "#FFF8F0"], ["surface", "#FFFFFF"],
    ]);
  });
  it("reads the first family of each font stack and the radius with its unit", () => {
    expect(b.fonts).toEqual({ heading: "Plus Jakarta Sans", body: "Inter" });
    expect(b.radius).toBe("12px");
  });
  it("leaves out anything it can't resolve to a real colour", () => {
    const ds = { ...AMA_DS, tokens: [{ ...AMA_DS.tokens[0], value: "var(--nope)" }, { ...AMA_DS.tokens[6], value: "var(--color-brand-primary-500)" }] };
    expect(brandFromDesignSystem(ds).colours).toEqual([]);
  });
  it("copes with nothing", () => expect(brandFromDesignSystem(null)).toEqual({ colours: [], fonts: {} }));
  it("never returns a bare generic family", () => expect(primaryFontOf("sans-serif")).toBeNull());
});

describe("mergeBrand: linked Strata project > the site's own brand > the account's > nothing", () => {
  it("a linked project wins over everything", () => {
    const r = mergeBrand({ siteId: "site-1", siteName: "Ama's Kitchen", linked: LINKED_AMA, own: OWN, profile: PROFILE });
    expect(r.source).toBe("strata");
    expect(r.linked).toBe(true);
    expect(r.syncOn).toBe(true);
    expect(r.colours[0]).toMatchObject({ role: "primary", value: "#E4572E" });
    expect(r.fonts.heading).toBe("Plus Jakarta Sans");
    expect(r.logoUrl).toBe("https://cdn.example.com/ama-logo.svg");
    expect(r.project).toEqual({ id: "proj-ama", name: "Ama's Kitchen brand" });
    expect(r.voice).toBe("warm and friendly");
  });
  it("without a link, the site's own saved brand wins over the account's", () => {
    const r = mergeBrand({ siteName: "S", own: OWN, profile: PROFILE });
    expect(r.source).toBe("site");
    expect(brandHexList(r)).toEqual(["#0F766E", "#134E4A"]);
    expect(r.logoUrl).toBe(OWN.logoUrl);
    expect(r.linked).toBe(false);
    expect(r.status).toBe("off");
  });
  it("without either, the account's onboarding brand", () => {
    const r = mergeBrand({ profile: PROFILE });
    expect(r.source).toBe("profile");
    expect(brandHexList(r)).toEqual(["#7C3AED"]);
    expect(r.logoUrl).toBe(PROFILE.logoUrl);
  });
  it("with nothing at all it is the default: no colours, no logo", () => {
    const r = mergeBrand({});
    expect(r.source).toBe("default");
    expect(r.colours).toEqual([]);
    expect(r.logoUrl).toBeUndefined();
  });
  it("a linked project with no logo keeps the site's own logo", () => {
    const r = mergeBrand({ linked: { ...LINKED_AMA, logoUrl: null }, own: OWN });
    expect(r.logoUrl).toBe(OWN.logoUrl);
  });
  it("the site's 'I have no logo' choice beats the account's logo", () => {
    const r = mergeBrand({ own: { colors: ["#0F766E"], noLogo: true }, profile: PROFILE });
    expect(r.noLogo).toBe(true);
    expect(r.logoUrl).toBeUndefined();
  });
  it("a link whose design system can't be read falls back to the site's brand but stays linked", () => {
    const r = mergeBrand({ linked: { ...LINKED_AMA, designSystem: null }, own: OWN });
    expect(r.source).toBe("site");
    expect(r.linked).toBe(true);
  });
  it("a site's own name beats the account's business name", () => expect(mergeBrand({ siteName: "Kitchen notes", profile: PROFILE }).name).toBe("Kitchen notes"));
  it("a site without a link only shows fonts it was built with, never the default Inter", () => {
    const ds = { ...AMA_DS, tokens: AMA_DS.tokens.map((x) => (x.key.startsWith("--font") ? { ...x, value: "Inter, sans-serif" } : x)) };
    expect(mergeBrand({ own: OWN, ownDesign: ds }).fonts).toEqual({});
    expect(mergeBrand({ own: OWN, ownDesign: AMA_DS }).fonts.heading).toBe("Plus Jakarta Sans");
  });
});

describe("applyBriefDefaults (what a build tool does when the caller passes no colours, fonts or logo)", () => {
  const resolved = mergeBrand({ linked: LINKED_AMA, profile: PROFILE });
  it("fills what is missing", () => {
    const { brief, filled } = applyBriefDefaults({ name: "Ama's Kitchen" } as { name: string; colors?: string[]; fonts?: unknown; logoUrl?: string; tone?: string }, resolved);
    expect(brief.colors).toEqual(["#E4572E", "#2B2D42", "#F4A261", "#1B1B1F"]);
    expect(brief.fonts).toEqual({ heading: "Plus Jakarta Sans", body: "Inter" });
    expect(brief.logoUrl).toBe("https://cdn.example.com/ama-logo.svg");
    expect(brief.tone).toBe("warm and friendly");
    expect(filled).toEqual(["colours", "fonts", "logo", "tone"]);
  });
  it("never overrides what the caller passed", () => {
    const { brief, filled } = applyBriefDefaults({ colors: ["navy"], fonts: { heading: "Lora" }, logoUrl: "https://x.test/l.png", tone: "bold" }, resolved);
    expect(brief).toEqual({ colors: ["navy"], fonts: { heading: "Lora" }, logoUrl: "https://x.test/l.png", tone: "bold" });
    expect(filled).toEqual([]);
  });
  it("does nothing without a brand", () => expect(applyBriefDefaults({ colors: undefined }, null).filled).toEqual([]));
});

describe("what SOL and MCP clients are told", () => {
  const linked = mergeBrand({ siteId: "site-1", siteName: "Ama's Kitchen", linked: LINKED_AMA, profile: PROFILE });
  it("the prompt block says where the brand comes from, lists roles and says to use it without being asked", () => {
    const p = brandPromptBlock(linked, "Ama's Kitchen");
    expect(p).toContain('Strata project "Ama\'s Kitchen brand"');
    expect(p).toContain("primary #E4572E");
    expect(p).toContain("Plus Jakarta Sans");
    expect(p).toContain("/__plexo/brand/site-1.css");
    expect(p).toMatch(/Never ask the owner for colours, fonts or a logo/);
    expect(p).toContain("I'll use your Ama's Kitchen brand.");
  });
  it("a site's own (unlinked) brand still produces a block, without Strata wording", () => {
    const p = brandPromptBlock(mergeBrand({ siteName: "S", own: OWN }), "S");
    expect(p).toContain("saved on this site");
    expect(p).not.toMatch(/Strata/);
  });
  it("nothing known gives no block", () => expect(brandPromptBlock(mergeBrand({}))).toBe(""));
  it("SOL's brief reads the linked colours, fonts, logo and project", () => {
    expect(knownBrandFromResolved(linked)).toEqual({ colors: ["#E4572E", "#2B2D42", "#F4A261", "#1B1B1F"], logoUrl: "https://cdn.example.com/ama-logo.svg", fonts: ["Plus Jakarta Sans", "Inter"], strataProject: "Ama's Kitchen brand" });
  });
  it("get_site_brand's answer has the facts and the precedence, and no secrets", () => {
    const out = brandForClient(linked);
    expect(out).toMatchObject({ source: "strata", autoSync: true, linkedProject: { id: "proj-ama" }, logoUrl: "https://cdn.example.com/ama-logo.svg" });
    expect(JSON.stringify(out)).not.toMatch(/ciphertext|token|secret|key/i);
  });
});

describe("sending a Plexo brand to a new Strata project", () => {
  const brand = mergeBrand({ own: { colors: ["#0F766E", "#134E4A"] }, ownDesign: { ...AMA_DS } });
  it("changes only what differs: second colour, accent, fonts; keeps existing tokens' names", () => {
    const { tokens, sent } = strataPushTokens(AMA_DS.tokens, { colours: [{ role: "primary", label: "", value: "#0F766E" }, { role: "secondary", label: "", value: "#134E4A" }], fonts: { heading: "Lora", body: "Inter" } });
    expect(tokens.map((x) => x.key)).toEqual(["--color-brand-secondary-500", "--font-family-heading"]);
    expect(tokens[0].value).toBe("#134E4A");
    expect(tokens[1].value.startsWith("Lora,")).toBe(true);
    expect(sent).toEqual(["second colour", "heading font"]);
    void brand;
  });
  it("adds a missing token on the brand layer", () => {
    const { tokens } = strataPushTokens([], { colours: [{ role: "accent", label: "", value: "#F4A261" }], fonts: {} });
    expect(tokens[0]).toMatchObject({ key: "--color-brand-accent-500", layer: "brand", type: "color" });
  });
  it("sends nothing when nothing differs", () => expect(strataPushTokens(AMA_DS.tokens, { colours: [{ role: "secondary", label: "", value: "#2B2D42" }], fonts: {} }).tokens).toEqual([]));
});

describe("small helpers", () => {
  it("picks the project's logo: a PRIMARY logo first, newest last in the list wins", () => {
    const a = [
      { kind: "image", url: "https://x/a.png", type: "LOGO", role: "SECONDARY" },
      { kind: "image", url: "https://x/b.png", type: "ILLUSTRATION" },
      { kind: "image", url: "https://x/c.png", type: "LOGO", role: "PRIMARY" },
      { kind: "image", url: "http://x/insecure.png", type: "LOGO", role: "PRIMARY" },
    ];
    expect(pickLogoAsset(a)?.url).toBe("https://x/c.png");
    expect(pickLogoAsset([{ kind: "video", url: "https://x/v.mp4", type: "LOGO" }])).toBeNull();
  });
  it("reads the brand choice a set-up screen sends", () => {
    expect(parseBrandChoice({ projectId: " p1 ", projectName: "Ama" })).toEqual({ projectId: "p1", projectName: "Ama" });
    expect(parseBrandChoice({ createFromBrand: true })).toEqual({ createFromBrand: true });
    expect(parseBrandChoice({ createFromBrand: "yes" })).toBeUndefined();
    expect(parseBrandChoice({ projectId: "x".repeat(300) })).toBeUndefined();
    expect(parseBrandChoice(null)).toBeUndefined();
    expect(parseBrandChoice([1])).toBeUndefined();
  });
});
