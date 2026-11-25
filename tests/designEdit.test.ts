import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>>, commands: [] as unknown[][] }));

vi.mock("@/lib/db/contentEntities", () => ({ Template: { get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.rows[id] ?? null }) }) } }));
vi.mock("@/lib/v2/designSystemStore", () => ({ resolveDesignSystem: async (d: unknown) => d }));
vi.mock("@/lib/v2/compile", () => ({ compileV2Design: async (d: { pages: unknown[] }) => `<html>${JSON.stringify(d.pages)}</html>` }));
// The SDK's schema check and command layer, reduced to what these tests need: a page containing FORBIDDEN is "invalid"; setBrand records its tokens.
vi.mock("@charisol/plexo-sdk/v2/compile", () => ({
  createDefaultDesignSystem: () => ({ tokens: [], components: [] }),
  parsePages: (pages: unknown) => (JSON.stringify(pages).includes("FORBIDDEN") ? { ok: false, error: "bad page" } : { ok: true, pages }),
  repairDesignSystem: (d: unknown) => d,
  applyCommands: (pages: unknown, ds: { tokens: unknown[] }, commands: Array<{ op: string; tokens: { primaryColor: string } }>) => {
    h.commands.push(commands);
    return { pages, designSystem: { ...ds, tokens: [...ds.tokens, { key: "--color-brand-primary-500", value: commands[0].tokens.primaryColor }] }, results: commands.map(() => ({ ok: true, message: "" })) };
  },
  blankPages: () => [],
  buildPageFromTemplate: () => ({}),
  templateSeed: () => "",
  starterEmailPages: () => [],
  MAX_CUSTOM_JS: 100000,
  convertV1Design: () => ({ page: { rootNode: { children: [] } } }),
  describeDesign: () => ({ pages: [{ sections: [] }] }),
}));

import { compileEdited, designToken, editDesign, loadListingForEdit, slotsKeyOf, slotsOfListing, type DesignEdits } from "@/lib/onboarding/designEdit";
import { listSlots } from "@/lib/onboarding/designSlots";

const section = (id: string, kind: string, content: Record<string, unknown>) => ({ id, type: "section", props: { block: { kind, content } } });
const listing = () => ({
  format: "plexo-v2@1",
  meta: { htmlTitle: "Iron & Grain: strength gym", metaDescription: "Iron & Grain trains you well" },
  designSystem: { tokens: [{ key: "--note", value: "Iron & Grain" }], components: [] },
  pages: [
    {
      id: "p1", name: "Home", slug: "",
      rootNode: {
        id: "root", type: "page",
        children: [
          section("h", "header", { brand: "Iron & Grain", logo: "", links: [{ label: "Home", href: "/" }] }),
          section("a", "hero", { headline: "Iron & Grain builds strength", sub: "Open daily until late for everyone nearby who wants to lift heavy", eyebrow: "", image: "https://x/gym.jpg" }),
          section("t", "testimonials", { items: [{ name: "Jane Doe", quote: "Best gym in town, truly" }] }),
          section("c", "cta", { label: "Learn more" }),
          section("f", "footer", { copyright: "© 2026 Iron & Grain" }),
        ],
      },
    },
  ],
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const content = (d: any, i: number) => d.pages[0].rootNode.children[i]?.props.block.content;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ids = (d: any) => d.pages[0].rootNode.children.map((c: { id: string }) => c.id);
const edits = (more: Partial<DesignEdits> = {}): DesignEdits => ({ name: "Aria Kitchen", designName: "Iron & Grain: strength gym", ...more });

beforeEach(() => {
  h.rows = {};
  h.commands = [];
});

describe("editing a marketplace design on its own data", () => {
  it("puts the owner's name where the design has its sample name, in the page, the header, the footer and the search details", async () => {
    const out = await editDesign(listing(), edits(), { look: false });
    expect(content(out.design, 0).brand).toBe("Aria Kitchen");
    expect(content(out.design, 1).headline).toBe("Aria Kitchen builds strength");
    expect(content(out.design, 4).copyright).toBe("© 2026 Aria Kitchen");
    expect((out.design as { meta: Record<string, string> }).meta).toEqual({ htmlTitle: "Aria Kitchen: strength gym", metaDescription: "Aria Kitchen trains you well" });
    expect(out.warnings).toEqual([]);
  });

  it("uses a real description as the intro line and the search description, and leaves a design instruction alone", async () => {
    const about = "We bake fresh sourdough and celebration cakes every morning in Ikeja, Lagos.";
    const out = await editDesign(listing(), edits({ about }), { look: false });
    expect(content(out.design, 1).sub).toBe(about);
    expect((out.design as { meta: Record<string, string> }).meta.metaDescription).toBe(about);
    const instruction = await editDesign(listing(), edits({ about: "I want a modern, minimal website with nice colours" }), { look: false });
    expect(content(instruction.design, 1).sub).toBe(content(listing() as never, 1).sub.replace("Iron & Grain", "Aria Kitchen"));
  });

  it("never changes the input or anything it does not rewrite (the brand, ids, pictures)", async () => {
    const original = listing();
    const snapshot = JSON.stringify(original);
    const out = await editDesign(original, edits(), { look: false });
    expect(JSON.stringify(original)).toBe(snapshot);
    expect((out.design as { designSystem: unknown }).designSystem).toEqual(original.designSystem);
    expect(content(out.design, 1).image).toBe("https://x/gym.jpg");
    expect(ids(out.design)).toEqual(["h", "a", "t", "c", "f"]);
  });

  it("applies SOL's numbered words over the name swap, so SOL's text is what the design holds", async () => {
    const slots = listSlots([{ role: "page", design: listing() }]);
    const n = (text: string) => String(slots.findIndex((s) => s.text === text));
    const out = await editDesign(listing(), edits({ slotsKey: slotsKeyOf(slots), copy: { [n("Iron & Grain builds strength")]: "Cakes baked fresh for you", [n("Learn more")]: "See the menu" } }), { look: false });
    expect(content(out.design, 1).headline).toBe("Cakes baked fresh for you");
    expect(content(out.design, 3).label).toBe("See the menu");
    expect(content(out.design, 0).brand).toBe("Aria Kitchen");
    expect(out.solApplied).toBe(2);
  });

  it("fills a blank optional line SOL was offered (text SOL adds with nothing to match in the old page)", async () => {
    const slots = listSlots([{ role: "page", design: listing() }]);
    const blank = slots.findIndex((s) => s.empty);
    expect(blank).toBeGreaterThan(-1);
    const out = await editDesign(listing(), edits({ copy: { [String(blank)]: "Fresh every morning" } }), { look: false });
    expect(content(out.design, 1).eyebrow).toBe("Fresh every morning");
  });

  it("removes an optional section SOL chose, and only ones that are offered", async () => {
    const out = await editDesign(listing(), edits({ remove: ["t", "h", "a"] }), { look: false });
    expect(ids(out.design)).toEqual(["h", "a", "c", "f"]);
    expect(out.removed).toEqual(["t"]);
  });

  it("swaps stock photos only when the design was made for another kind of business", async () => {
    const other = await editDesign(listing(), edits({ domain: "food", designDescription: "A gym" }), { look: false });
    expect(content(other.design, 1).image).not.toBe("https://x/gym.jpg");
    const same = await editDesign(listing(), edits({ domain: "other" }), { look: false });
    expect(content(same.design, 1).image).toBe("https://x/gym.jpg");
  });

  it("puts the brand's colour and logo into the design when asked (the preview), with the Brand page's own change", async () => {
    const out = await editDesign(listing(), edits({ colors: ["#2255EE", "#111111"], logoUrl: "https://x/logo.png" }), { look: true });
    expect(h.commands[0]).toEqual([{ op: "setBrand", tokens: { primaryColor: "#2255EE", secondaryColor: "#111111" } }]);
    expect((out.design as { designSystem: { tokens: Array<{ value: string }> } }).designSystem.tokens.at(-1)?.value).toBe("#2255EE");
    expect(content(out.design, 0).logo).toBe("https://x/logo.png");
  });

  it("leaves the colour and logo to the site's Brand tab when making the site (look: false)", async () => {
    const out = await editDesign(listing(), edits({ colors: ["#2255EE"], logoUrl: "https://x/logo.png" }), { look: false });
    expect(h.commands).toEqual([]);
    expect(content(out.design, 0).logo).toBe("");
  });

  it("says so in plain words when the design has no header for the logo", async () => {
    const d = listing();
    d.pages[0].rootNode.children.shift();
    const out = await editDesign(d, edits({ logoUrl: "https://x/logo.png" }), { look: true });
    expect(out.warnings.join(" ")).toContain("no place for it in the header");
  });

  it("rejects SOL output that would make the design invalid, falling back to the owner's name and colour only", async () => {
    const slots = listSlots([{ role: "page", design: listing() }]);
    const i = slots.findIndex((s) => s.text === "Learn more");
    const out = await editDesign(listing(), edits({ copy: { [String(i)]: "FORBIDDEN words" } }), { look: false });
    expect(JSON.stringify(out.design)).not.toContain("FORBIDDEN");
    expect(content(out.design, 0).brand).toBe("Aria Kitchen");
    expect(out.solApplied).toBe(0);
    expect(out.warnings[0]).toContain("SOL's new words couldn't be fitted");
    expect(out.warnings[0]).not.toMatch(/json|schema|parse/i);
  });

  it("does not use SOL's numbered words on a listing that changed since SOL read it", async () => {
    const slots = listSlots([{ role: "page", design: listing() }]);
    const out = await editDesign(listing(), edits({ slotsKey: "0123456789abcdef", copy: { "0": "Nope" } }), { look: false });
    expect(content(out.design, 0).brand).toBe("Aria Kitchen");
    expect(out.solApplied).toBe(0);
    expect(out.warnings[0]).toContain("updated by its maker");
    expect(slotsKeyOf(slots)).toMatch(/^[a-f0-9]{16}$/);
  });

  it("gives the same design every time from the same listing and recipe, so the preview is what the new site holds", async () => {
    const e = edits({ about: "We bake fresh sourdough and celebration cakes every morning in Ikeja.", copy: { "3": "Hello Lagos" } });
    expect(await editDesign(listing(), e, { look: false })).toEqual(await editDesign(listing(), e, { look: false }));
    expect(designToken("d1", e)).toBe(designToken("d1", { ...e }));
    expect(designToken("d1", e)).not.toBe(designToken("d1", { ...e, name: "Other" }));
    expect(designToken("d1", e)).not.toBe(designToken("d2", e));
  });
});

describe("the listing and the preview", () => {
  const row = (more: Record<string, unknown> = {}) => ({ id: "d1", name: "Iron & Grain: strength gym", kind: "LANDING_PAGE", sourceType: "BUILDER", designFormat: "v2", marketplaceStatus: "PUBLISHED", marketplaceDescription: "A gym", designJson: listing(), ...more });

  it("loads only a published new-editor page design", async () => {
    h.rows = { d1: row(), v1: row({ id: "v1", designFormat: "v1" }), em: row({ id: "em", kind: "EMAIL" }), up: row({ id: "up", sourceType: "RAW_UPLOAD" }), off: row({ id: "off", marketplaceStatus: "DRAFT" }) };
    expect((await loadListingForEdit("d1"))?.name).toBe("Iron & Grain: strength gym");
    for (const id of ["v1", "em", "up", "off", "missing", "bad id!"]) expect(await loadListingForEdit(id)).toBeNull();
  });

  it("compiles the preview FROM the edited design, so the HTML is only ever derived from the data", async () => {
    h.rows = { d1: row() };
    const l = (await loadListingForEdit("d1"))!;
    const edited = await editDesign(l.designJson, edits(), { look: false });
    const html = await compileEdited(l, edited.design);
    expect(html).toContain("Aria Kitchen builds strength");
    expect(html).not.toContain("Iron & Grain builds");
    expect(slotsOfListing(l).removable.map((s) => s.id)).toEqual(["t"]);
  });
});
