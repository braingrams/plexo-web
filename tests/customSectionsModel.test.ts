import { describe, expect, it } from "vitest";
import { renderCustomSectionHtml } from "@charisol/plexo-sdk/v2/compile";
import { checkSectionHtml, normalizeSectionFields, normalizeSectionTypeInput, sampleDefaults } from "@/lib/customSections/model";
import { LAYOUT_PRESETS } from "@/lib/customSections/presets";
import { STARTER_SECTION_TYPES } from "@/lib/customSections/starters";

describe("custom section types", () => {
  it("the starters and presets are valid out of the box", () => {
    for (const s of [...STARTER_SECTION_TYPES, ...LAYOUT_PRESETS]) {
      const fields = normalizeSectionFields(s.fields);
      expect("error" in fields ? fields.error : null).toBeNull();
      if ("value" in fields) expect(checkSectionHtml(s.html, fields.value)).toBeNull();
    }
  });

  it("derives field names from what the owner typed and rejects duplicates in plain words", () => {
    const ok = normalizeSectionFields([{ label: "Quote author", type: "text" }]);
    expect("value" in ok && ok.value[0].key).toBe("quote_author");
    const dup = normalizeSectionFields([{ label: "Name", type: "text" }, { label: "name", type: "text" }]);
    expect("error" in dup && dup.error).toMatch(/Two fields are called/);
  });

  it("a repeating group needs something inside it", () => {
    const r = normalizeSectionFields([{ label: "People", type: "list", item: [] }]);
    expect("error" in r && r.error).toMatch(/needs at least one field/);
  });

  it("the design may only mention fields that exist and must close every repeat", () => {
    const fields = (normalizeSectionFields([{ label: "Heading", type: "text" }, { label: "Rows", type: "list", item: [{ label: "Title", type: "text" }] }]) as { value: never[] }).value;
    expect(checkSectionHtml("<h2>{{heading}}</h2>{{#rows}}<p>{{title}} {{@number}} {{tone.body}}</p>{{/rows}}", fields)).toBeNull();
    expect(checkSectionHtml("<h2>{{headin}}</h2>", fields)).toMatch(/no field with that name/);
    expect(checkSectionHtml("{{#rows}}<p>x</p>", fields)).toMatch(/never closed/);
    expect(checkSectionHtml("   ", fields)).toMatch(/can't be empty/);
  });

  it("asks 'What are you creating?' when the name is missing, and fills sample words when none are given", () => {
    const none = normalizeSectionTypeInput({ fields: [{ label: "Heading", type: "text" }], html: "<h2>{{heading}}</h2>" });
    expect("error" in none && none.error).toMatch(/What are you creating/);
    const ok = normalizeSectionTypeInput({ name: "Notes", fields: [{ label: "Heading", type: "text" }], html: "<h2>{{heading}}</h2>" });
    expect("value" in ok && ok.value.defaults).toEqual({ heading: "Heading" });
  });

  it("sample rows follow the group's limit", () => {
    const d = sampleDefaults([{ key: "items", label: "Items", type: "list", limit: 2, item: [{ key: "t", label: "Title", type: "text" }] }]);
    expect((d.items as unknown[]).length).toBe(2);
  });
});

describe("formatted text, links, colours and help text", () => {
  it("accepts the new field kinds, with help text and examples", () => {
    const r = normalizeSectionFields([
      { label: "Bio", type: "richtext", hint: "Say a little about them", placeholder: "e.g. Ada writes code" },
      { label: "Website", type: "link" },
      { label: "Accent", type: "color" },
      { label: "People", type: "list", item: [{ label: "Name", type: "text", placeholder: "e.g. Ada" }, { label: "Story", type: "richtext" }] },
    ]);
    expect("error" in r ? r.error : null).toBeNull();
    if ("value" in r) {
      expect(r.value[0]).toMatchObject({ key: "bio", type: "richtext", hint: "Say a little about them", placeholder: "e.g. Ada writes code" });
      expect(r.value[3].item?.[0].placeholder).toBe("e.g. Ada");
    }
  });

  it("won't let a formatted-text field share its name with another field", () => {
    const r = normalizeSectionFields([{ label: "Story", type: "text" }, { label: "People", type: "list", item: [{ label: "Story", type: "richtext" }] }]);
    expect("error" in r && r.error).toMatch(/shares its name/);
  });

  it("starter words and pictures make a brand-new section look finished", () => {
    const fields = (normalizeSectionFields([{ label: "Photo", type: "image" }, { label: "Story", type: "richtext" }, { label: "Site", type: "link" }]) as { value: never[] }).value;
    const d = sampleDefaults(fields) as Record<string, string>;
    expect(d.photo).toMatch(/^data:image\/svg\+xml/);
    expect(d.story).toContain("<p>");
    expect(d.site).toBe("#");
  });

  it("every ready-made look has starting content for each of its fields", () => {
    for (const p of LAYOUT_PRESETS) {
      expect(p.defaults, p.id).toBeTruthy();
      for (const f of p.fields) expect(p.defaults, `${p.id}.${f.key}`).toHaveProperty(f.key);
    }
  });
});

describe("the preview matches what visitors see", () => {
  it("draws every ready-made look with its starting content, formatting kept and nothing leaking as text", () => {
    for (const p of LAYOUT_PRESETS) {
      const out = renderCustomSectionHtml({ fields: p.fields as never, html: p.html }, p.defaults ?? {}, { align: "left", tone: { heading: "#111", body: "#444", muted: "#666", accent: "#00f", line: "#ddd", card: "#eee", onAccent: "#fff" } });
      expect(out.length, p.id).toBeGreaterThan(200);
      expect(out, p.id).not.toContain("&lt;p&gt;");
      expect(out, p.id).not.toMatch(/\{\{/);
    }
  });
});
