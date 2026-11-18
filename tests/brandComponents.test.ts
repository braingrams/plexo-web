import { describe, expect, it } from "vitest";
import { brandComponentCss } from "@charisol/plexo-sdk/v2/compile";
import { brandComponentClass, buildComponentRow, catalogueFromDesignSystem, ComponentInputError, mergeComponentRows, usageHint } from "@/lib/brand/brandComponents";
import { brandForClient, brandPromptBlock, knownBrandFromResolved, mergeBrand, planTokenChanges, tokensForClient } from "@/lib/brand/brandModel";
import { PLEXO_BRAND_DS } from "./fixtures/strata/plexoBrandDesign";

const linked = { projectId: "01a1e54e", projectName: "Plexo", syncOn: true, status: "active" as const, designSystem: PLEXO_BRAND_DS, stylesheet: "/__plexo/brand/s1.css" };
const tokenKeys = PLEXO_BRAND_DS.tokens.map((t) => t.key);

describe("the brand's component catalogue", () => {
  it("lists the button and the card of Plexo's own Strata project with their looks and parts", () => {
    const cat = catalogueFromDesignSystem(PLEXO_BRAND_DS);
    expect(cat.map((c) => c.name)).toEqual(["button", "card"]);
    const button = cat[0];
    expect(button.variants).toEqual(["primary", "secondary", "ghost"]);
    expect(button.slots).toEqual([{ role: "label", kind: "text", sample: "Button" }]);
    expect(cat[1].variants).toEqual(["raised", "muted"]);
    expect(cat[1].slots.map((s) => s.role)).toEqual(["title", "body"]);
  });
  it("uses the class names the hosted brand sheet really has", () => {
    const css = brandComponentCss(PLEXO_BRAND_DS);
    for (const c of catalogueFromDesignSystem(PLEXO_BRAND_DS)) {
      expect(css).toContain(`.${c.className}`);
      for (const v of c.variants) expect(css).toContain(`.${c.className}--${v}`);
    }
    expect(brandComponentClass("Hero Banner")).toBe("plx-brand-hero-banner");
  });
  it("groups rows of the same component and ignores junk", () => {
    const ds = { components: [{ name: "alert", variant: "info", nodes: [] }, { name: "alert", variant: "error", nodes: [] }, { name: "", variant: "x", nodes: [] }, null] } as never;
    expect(catalogueFromDesignSystem(ds)).toEqual([{ name: "alert", variants: ["info", "error"], slots: [], className: "plx-brand-alert" }]);
    expect(catalogueFromDesignSystem(null)).toEqual([]);
  });
  it("is part of the resolved brand, the client shape, and SOL's brand block (with the use-first rule)", () => {
    const b = mergeBrand({ siteId: "s1", linked });
    expect(b.components.map((c) => c.name)).toEqual(["button", "card"]);
    expect(mergeBrand({ siteId: "s1" }).components).toEqual([]);
    expect((brandForClient(b).components as Array<{ howToUse: string }>)[0].howToUse).toContain("plx-brand-button");
    expect(knownBrandFromResolved(b).brandComponents).toEqual(["button", "card"]);
    const block = brandPromptBlock(b, "Plexo");
    expect(block).toContain("button (looks: primary, secondary, ghost), fill in: label");
    expect(block).toMatch(/before inventing your own/);
    expect(block).toContain("I'll use your brand's <name>");
    expect(block).toContain("create_brand_component");
  });
  it("tells SOL to offer saving reusable things when a linked brand has no components yet", () => {
    const empty = mergeBrand({ siteId: "s1", linked: { ...linked, designSystem: { ...PLEXO_BRAND_DS, components: [] } } });
    expect(brandPromptBlock(empty, "Plexo")).toMatch(/none yet.*offer once to save it/);
  });
});

describe("making a component from a description", () => {
  const card = {
    name: "Pricing Card",
    styles: { padding: "var(--space-5)", "background-color": "var(--color-bg-surface)", borderRadius: "var(--radius-lg)" },
    variants: { featured: { "border": "2px solid var(--color-brand-primary)" } },
    slots: [{ role: "title", tag: "h3", text: "Starter", styles: { margin: 0 } }, { role: "price", tag: "p", text: "$9" }],
  };
  it("builds the row Strata stores, with the looks on the outer element and the parts as children", () => {
    const row = buildComponentRow(card, tokenKeys);
    expect(row).toMatchObject({ name: "pricing-card", variant: "default", props: {} });
    const root = row.nodes[0];
    expect(root).toMatchObject({ tag: "div", role: "root" });
    expect(root.properties?.["border-radius"]).toEqual({ value: "var(--radius-lg)", type: "string" });
    expect(root.properties?.["background-color"].type).toBe("color");
    expect(root.variants?.featured.properties?.border.value).toBe("2px solid var(--color-brand-primary)");
    expect(root.children?.map((c) => [c.role, c.tag, c.textContent])).toEqual([["title", "h3", "Starter"], ["price", "p", "$9"]]);
  });
  it("round-trips into the brand sheet and the catalogue", () => {
    const row = buildComponentRow(card, tokenKeys);
    const css = brandComponentCss({ components: [row] });
    expect(css).toContain(".plx-brand-pricing-card");
    expect(css).toContain(".plx-brand-pricing-card--featured");
    const [info] = catalogueFromDesignSystem({ components: [row] });
    expect(info.variants).toEqual(["featured"]);
    expect(usageHint(info)).toContain("plx-brand-pricing-card--<look>");
  });
  it.each([
    [{ ...card, name: "" }, /short name/],
    [{ ...card, tag: "script" }, /can't be made from <script>/],
    [{ ...card, styles: {} }, /Say how it looks/],
    [{ ...card, styles: { background: "url(https://evil.example/x.png)" } }, /isn't allowed/],
    [{ ...card, styles: { padding: "var(--not-a-token)" } }, /doesn't have/],
    [{ ...card, styles: { "x y": "1" } }, /isn't a style/],
    [{ ...card, slots: [{ role: "a" }, { role: "a" }] }, /both called/],
    [{ ...card, slots: [{ role: "t", tag: "iframe" }] }, /can't be a <iframe>/],
    [{ ...card, slots: [{ role: "t", text: "<b>hi</b>" }] }, /markup/],
    [{ ...card, variants: { default: { color: "red" } } }, /can't be a look's name/],
  ])("refuses unsafe or unclear input in plain words", (input, message) => {
    expect(() => buildComponentRow(input, tokenKeys)).toThrow(ComponentInputError);
    expect(() => buildComponentRow(input, tokenKeys)).toThrow(message);
  });
  it("replaces a row with the same name and look, adds the rest, never mutates", () => {
    const rows = PLEXO_BRAND_DS.components;
    const next = mergeComponentRows(rows, [{ name: "Button", variant: "default", nodes: [] }, buildComponentRow(card, null)]);
    expect(next.map((r) => r.name)).toEqual(["card", "Button", "pricing-card"]);
    expect(rows).toHaveLength(2);
  });
});

describe("changing a project's tokens", () => {
  const tokens = PLEXO_BRAND_DS.tokens;
  it("changes the main colour on the token the project has, and nothing when it already matches", () => {
    const r = planTokenChanges(tokens, { colours: { primary: "#112233" } });
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]).toMatchObject({ key: "--color-brand-primary", value: "#112233" });
    expect(r.sent).toEqual(["main colour"]);
    expect(planTokenChanges(tokens, { colours: { primary: "#b8f34a" } }).tokens).toEqual([]);
  });
  it("skips a colour that isn't a hex value, with a plain reason", () => {
    const r = planTokenChanges(tokens, { colours: { primary: "red" } });
    expect(r.tokens).toEqual([]);
    expect(r.skipped[0]).toMatch(/hex colour/);
  });
  it("follows the project's own shape for fonts, corners and spacing", () => {
    const r = planTokenChanges(tokens, { fonts: { body: "Inter" }, radius: 8, spacing: { "4": 18 } });
    const byKey = Object.fromEntries(r.tokens.map((t) => [t.key, t]));
    expect(byKey["--font-family-base"].value).toMatch(/^Inter,/);
    expect(byKey["--radius-md"].value).toBe("8px");
    expect(byKey["--space-4"].value).toBe("18px");
    expect(r.sent).toEqual(expect.arrayContaining(["font", "corner roundness", "spacing step 4"]));
  });
  it("a heading font alone goes to the shared font when the project has no separate heading font", () => {
    const r = planTokenChanges(tokens, { fonts: { heading: "Playfair Display" } });
    expect(r.tokens[0].key).toBe("--font-family-base");
  });
  it("refuses values that aren't safe or in range, and spacing steps that aren't standard", () => {
    const r = planTokenChanges(tokens, { radius: 500, fonts: { body: "x;y" }, spacing: { "99": 4, bogus: 2 } });
    expect(r.tokens).toEqual([]);
    expect(r.skipped).toHaveLength(4);
  });
  it("lists tokens for an AI with references resolved", () => {
    const list = tokensForClient(PLEXO_BRAND_DS);
    expect(list.find((t) => t.key === "--color-action-primary")).toMatchObject({ value: "var(--color-brand-primary)", resolved: "#B8F34A" });
  });
});
