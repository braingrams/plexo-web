import { beforeEach, describe, expect, it, vi } from "vitest";
import { customKindOf } from "@charisol/plexo-sdk/v2/compile";

// ---- an in-memory stand-in for the three tables the index touches
const store = {
  placements: new Map<string, Record<string, unknown>>(),
  markers: new Map<string, Record<string, unknown>>(),
  pages: new Map<string, Record<string, unknown>>(),
};
const pk = (r: Record<string, string>) => `${r.siteId}|${r.typeId}|${r.pageId}|${r.sectionId}`;

vi.mock("@/lib/db/customSectionEntities", () => ({
  CustomSectionPlacement: {
    put: (rows: Array<Record<string, string>>) => ({ go: async () => rows.forEach((r) => store.placements.set(pk(r), r)) }),
    delete: (rows: Array<Record<string, string>>) => ({ go: async () => rows.forEach((r) => store.placements.delete(pk(r))) }),
    query: { primary: ({ siteId }: { siteId: string }) => ({ go: async () => ({ data: [...store.placements.values()].filter((r) => r.siteId === siteId) }) }) },
  },
  CustomSectionPageMarker: {
    get: ({ siteId, pageId }: Record<string, string>) => ({ go: async () => ({ data: store.markers.get(`${siteId}|${pageId}`) ?? null }) }),
    put: (r: Record<string, string>) => ({ go: async () => void store.markers.set(`${r.siteId}|${r.pageId}`, r) }),
    delete: (r: Record<string, string> | Array<Record<string, string>>) => ({ go: async () => void [r].flat().forEach(({ siteId, pageId }) => store.markers.delete(`${siteId}|${pageId}`)) }),
    query: { primary: ({ siteId }: { siteId: string }) => ({ go: async () => ({ data: [...store.markers.values()].filter((r) => r.siteId === siteId) }) }) },
  },
}));
vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: store.pages.get(id) ?? null }) }),
    query: { byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: [...store.pages.values()].filter((p) => p.parentId === parentId) }) }) },
  },
}));
const TYPE = { id: "t-1", siteId: "site", name: "Team", fields: [{ key: "heading", label: "Heading", type: "text" }, { key: "items", label: "People", type: "list", itemName: "person", item: [{ key: "name", label: "Name", type: "text" }, { key: "bio", label: "Bio", type: "richtext" }] }], html: "x", updatedAt: "1" };
vi.mock("@/lib/customSections/service", () => ({
  listSectionTypes: async () => [TYPE],
  siteIdForTemplate: async (t: { id: string; parentId?: string | null }) => t.parentId ?? t.id,
}));
vi.mock("@/server/slugDynamo", () => ({
  pathForPage: (id: string, pages: Array<{ id: string; parentId: string | null; slug: string | null }>) => {
    const byId = new Map(pages.map((p) => [p.id, p]));
    const seg: string[] = [];
    for (let c = byId.get(id); c && c.parentId; c = byId.get(c.parentId)) if (c.slug) seg.unshift(c.slug);
    return "/" + seg.join("/");
  },
}));

import { findUses, keyTextOf, rowCountOf, siteEntries, syncPageEntries, forgetPageEntries, forgetSiteEntries, typesByKindOf } from "@/lib/customSections/placements";
import { contentPatch } from "@/lib/customSections/contentPatch";

const section = (id: string, content: Record<string, unknown>) => ({ id, type: "section", props: { block: { kind: customKindOf(TYPE.id), variant: "default", content } }, children: [] });
const design = (...sections: unknown[]) => ({ pages: [{ id: "p", rootNode: { id: "root", type: "page", children: sections } }] });
const addPage = (id: string, name: string, parentId: string | null, d: unknown, extra: Record<string, unknown> = {}) =>
  store.pages.set(id, { id, name, parentId, slug: parentId ? name.toLowerCase() : null, kind: "LANDING_PAGE", designFormat: "v2", organizationId: "org", designJson: d, updatedAt: `t-${id}-1`, ...extra });

beforeEach(() => {
  store.placements.clear();
  store.markers.clear();
  store.pages.clear();
});

describe("what identifies a use", () => {
  it("takes the first words written, as plain text, else the first row's name", () => {
    expect(keyTextOf(TYPE.fields as never, { heading: "  Meet   us ", items: [] })).toBe("Meet us");
    expect(keyTextOf(TYPE.fields as never, { heading: "", items: [{ name: "", bio: "<p>Hello <b>there</b></p>" }, { name: "Ada" }] })).toBe("Hello there");
    expect(keyTextOf(TYPE.fields as never, { heading: "", items: [{ name: "Ada" }] })).toBe("Ada");
    expect(keyTextOf(TYPE.fields as never, {})).toBe("");
  });
  it("counts the repeated rows, and nothing for a type that doesn't repeat", () => {
    expect(rowCountOf(TYPE.fields as never, { items: [{}, {}, {}] })).toBe(3);
    expect(rowCountOf(TYPE.fields as never, {})).toBe(0);
    expect(rowCountOf([{ key: "a", label: "A", type: "text" }], {})).toBeNull();
  });
  it("finds uses anywhere in a design and ignores other sections", () => {
    const d = design(section("a", { heading: "One" }), { id: "x", type: "section", props: { block: { kind: "hero", content: {} } } }, { id: "c", type: "container", children: [section("b", { heading: "Two" })] });
    expect(findUses(d, typesByKindOf([TYPE as never])).map((u) => u.sectionId)).toEqual(["a", "b"]);
    expect(findUses(null, typesByKindOf([TYPE as never]))).toEqual([]);
  });
});

describe("the placement index", () => {
  it("indexes a saved page, follows edits, and drops sections that were removed", async () => {
    addPage("site", "Home", null, design(section("a", { heading: "One", items: [{ name: "x" }] })));
    await syncPageEntries("site");
    let rows = await siteEntries("site", "org", [TYPE as never]);
    expect(rows).toMatchObject([{ pageId: "site", sectionId: "a", keyText: "One", rows: 1, pagePath: "/" }]);

    addPage("site", "Home", null, design(section("b", { heading: "Two", items: [] })), { updatedAt: "t-site-2" });
    await syncPageEntries("site");
    rows = await siteEntries("site", "org", [TYPE as never]);
    expect(rows.map((r) => r.sectionId)).toEqual(["b"]);
  });

  it("shows the working copy's words when the page has unpublished changes", async () => {
    addPage("site", "Home", null, design(section("a", { heading: "Live" })), { draftJson: design(section("a", { heading: "Draft" })) });
    await syncPageEntries("site");
    const rows = await siteEntries("site", "org", [TYPE as never]);
    expect(rows[0]).toMatchObject({ keyText: "Draft", draft: true });
  });

  it("backfills a site that was never indexed, and notices pages changed from elsewhere", async () => {
    addPage("site", "Home", null, design(section("a", { heading: "Home words" })));
    addPage("p2", "About", "site", design(section("c", { heading: "About words" })));
    let rows = await siteEntries("site", "org", [TYPE as never]);
    expect(rows.map((r) => r.keyText).sort()).toEqual(["About words", "Home words"]);
    expect(rows.find((r) => r.pageId === "p2")?.pagePath).toBe("/about");

    addPage("p2", "About", "site", design(section("c", { heading: "Changed elsewhere" })), { updatedAt: "t-p2-2" }); // no sync call
    rows = await siteEntries("site", "org", [TYPE as never]);
    expect(rows.find((r) => r.pageId === "p2")?.keyText).toBe("Changed elsewhere");
  });

  it("stays right when a page is duplicated or deleted", async () => {
    addPage("site", "Home", null, design(section("a", { heading: "Words" })));
    addPage("copy", "Copy of Home", "site", design(section("a", { heading: "Words" }))); // same section id on another page
    expect((await siteEntries("site", "org", [TYPE as never])).length).toBe(2);

    await forgetPageEntries("site", ["copy"]);
    store.pages.delete("copy");
    expect((await siteEntries("site", "org", [TYPE as never])).map((r) => r.pageId)).toEqual(["site"]);

    // a page removed without telling the index is dropped on the next listing
    store.pages.delete("site");
    addPage("site", "Home", null, design(), { updatedAt: "t-site-9" });
    expect(await siteEntries("site", "org", [TYPE as never])).toEqual([]);
    expect(store.placements.size).toBe(0);
  });

  it("re-reads every page when a section type changes, and forgets a deleted site", async () => {
    addPage("site", "Home", null, design(section("a", { heading: "Words" })));
    await siteEntries("site", "org", [TYPE as never]);
    const stampBefore = (store.markers.get("site|site") as { typesStamp: string }).typesStamp;
    await siteEntries("site", "org", [{ ...TYPE, updatedAt: "2" } as never]);
    expect((store.markers.get("site|site") as { typesStamp: string }).typesStamp).not.toBe(stampBefore);
    await forgetSiteEntries("site");
    expect(store.placements.size + store.markers.size).toBe(0);
  });

  it("hides uses of a type that was removed", async () => {
    addPage("site", "Home", null, design(section("a", { heading: "Words" })));
    await siteEntries("site", "org", [TYPE as never]);
    expect(await siteEntries("site", "org", [])).toEqual([]);
  });
});

describe("saving one use's form as the smallest change", () => {
  const before = { heading: "A", items: [{ _key: "k1", name: "x", bio: "<p>1</p>" }, { _key: "k2", name: "y", bio: "<p>2</p>" }] };
  it("changes a field, a cell, and nothing else", () => {
    expect(contentPatch(TYPE.fields as never, before, { ...before, heading: "B" })).toEqual({ heading: "B" });
    const edited = { ...before, items: [{ ...before.items[0] }, { ...before.items[1], name: "z" }] };
    expect(contentPatch(TYPE.fields as never, before, edited)).toEqual({ "items.1.name": "z" });
    expect(contentPatch(TYPE.fields as never, before, before)).toEqual({});
  });
  it("sends a list whole (without row ids) when rows were added, removed or reordered", () => {
    const added = { ...before, items: [...before.items, { name: "w", bio: "" }] };
    expect(contentPatch(TYPE.fields as never, before, added)).toEqual({ items: [{ name: "x", bio: "<p>1</p>" }, { name: "y", bio: "<p>2</p>" }, { name: "w", bio: "" }] });
    const removed = { ...before, items: [before.items[1]] };
    expect(Object.keys(contentPatch(TYPE.fields as never, before, removed))).toEqual(["items"]);
  });
});
