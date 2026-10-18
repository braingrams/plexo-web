import { describe, expect, it, vi } from "vitest";
import { blankPages, createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";

import { buildV2SavePayload, leaveAfterSaving, newPageBody, pageSourcePages, postV2Draft, routeOf, stockProviders, type TreePage } from "@/app/dashboard/templates/[id]/v2/logic";
import { anchorTypeOf } from "@/app/dashboard/templates/[id]/comments/CommentLayer";
import { canMoveToV2, convertV1ToV2, describeConversion } from "@/lib/v2/convertV1";
import { designFormatOf, parseV2Design, V2_FORMAT } from "@/lib/v2/design";

const page = blankPages()[0];

describe("which editor a template opens in", () => {
  it("a row with no format, or v1, is the classic editor; only v2 is the new one", () => {
    expect(designFormatOf({})).toBe("v1");
    expect(designFormatOf({ designFormat: undefined })).toBe("v1");
    expect(designFormatOf({ designFormat: "v1" })).toBe("v1");
    expect(designFormatOf({ designFormat: "v2" })).toBe("v2");
  });
});

describe("what a save sends", () => {
  it("is the one-page payload the autosave route expects", () => {
    const body = buildV2SavePayload({ page, includeDesignSystem: false });
    expect(body).toEqual({ format: V2_FORMAT, pages: [page] });
    expect(parseV2Design(body).ok).toBe(true);
  });

  it("leaves out the built-in design system, but sends a customised one on every save", () => {
    const ds = createDefaultDesignSystem();
    expect(buildV2SavePayload({ page, designSystem: ds, includeDesignSystem: false })).not.toHaveProperty("designSystem");
    expect(buildV2SavePayload({ page, designSystem: ds, includeDesignSystem: true }).designSystem).toBe(ds);
  });

  it("carries the owner's script and page details, and drops empty ones", () => {
    const full = buildV2SavePayload({ page, includeDesignSystem: false, customJs: "console.log(1)", meta: { htmlTitle: "Hi", metaDescription: "" } });
    expect(full.customJs).toBe("console.log(1)");
    expect(full.meta).toEqual({ htmlTitle: "Hi", metaDescription: "" });
    const empty = buildV2SavePayload({ page, includeDesignSystem: false, customJs: "  ", meta: { htmlTitle: " ", favicon: "" } });
    expect(empty).not.toHaveProperty("customJs");
    expect(empty).not.toHaveProperty("meta");
  });

  it("posts to the existing autosave route and surfaces the server's own words on failure", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    await postV2Draft("t1", buildV2SavePayload({ page, includeDesignSystem: false }), ok as unknown as typeof fetch);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/templates/update/t1");
    expect(JSON.parse(init.body as string).designJson.format).toBe(V2_FORMAT);

    const bad = vi.fn(async () => new Response(JSON.stringify({ error: "This page is too large to save." }), { status: 400 }));
    await expect(postV2Draft("t1", buildV2SavePayload({ page, includeDesignSystem: false }), bad as unknown as typeof fetch)).rejects.toThrow("too large");
  });
});

const tree: TreePage[] = [
  { id: "root", name: "Home", slug: null, parentId: null, order: 0 },
  { id: "b", name: "Blog", slug: "blog", parentId: "root", order: 2 },
  { id: "a", name: "About", slug: "about", parentId: "root", order: 1 },
  { id: "p", name: "Post", slug: "first", parentId: "b", order: 0 },
];

describe("the site's pages in the editor", () => {
  it("lists the home page first, then pages in the owner's order, with their addresses", () => {
    expect(pageSourcePages(tree)).toEqual([
      { id: "root", name: "Home", route: "/" },
      { id: "a", name: "About", route: "/about" },
      { id: "b", name: "Blog", route: "/blog" },
      { id: "p", name: "Post", route: "/blog/first" },
    ]);
    expect(routeOf("p", tree)).toBe("/blog/first");
  });

  it("a new page is created inside the site, in the new editor, from the chosen design", () => {
    expect(newPageBody({ name: " About us ", rootId: "root", templateId: "about" })).toEqual({ name: "About us", parentId: "root", slug: "about-us", designFormat: "v2", pageTemplate: "about" });
    expect(newPageBody({ name: "", rootId: "root", templateId: "blank" })).not.toHaveProperty("pageTemplate");
  });
});

describe("switching pages", () => {
  it("saves the open page first, then moves", async () => {
    const order: string[] = [];
    const left = await leaveAfterSaving({ dirty: true, save: async () => void order.push("save"), leave: () => void order.push("leave") });
    expect(left).toBe(true);
    expect(order).toEqual(["save", "leave"]);
  });

  it("does not save a page nothing changed on", async () => {
    const save = vi.fn(async () => {});
    await leaveAfterSaving({ dirty: false, save, leave: () => {} });
    expect(save).not.toHaveBeenCalled();
  });

  it("stays on the page when the save fails, so nothing is lost", async () => {
    const leave = vi.fn();
    const left = await leaveAfterSaving({ dirty: true, save: async () => { throw new Error("nope"); }, leave });
    expect(left).toBe(false);
    expect(leave).not.toHaveBeenCalled();
  });
});

describe("stock photos", () => {
  it("offers only the providers that have a key", () => {
    expect(stockProviders({ unsplash: "k", pixabay: "p" }).map((p) => p.id)).toEqual(["unsplash", "pixabay"]);
    expect(stockProviders({})).toEqual([]);
  });
});

describe("comments", () => {
  it("classic comment anchors pass through untouched; new-editor nodes map onto them", () => {
    expect(anchorTypeOf("row")).toBe("row");
    expect(anchorTypeOf("column")).toBe("column");
    expect(anchorTypeOf("element")).toBe("element");
    expect(anchorTypeOf("section")).toBe("row");
    expect(anchorTypeOf("heading")).toBe("element");
  });
});

const v1 = (text: string, extra: Record<string, unknown> = {}) => ({
  body: {
    style: { background: "#fff", htmlTitle: "Tab title", metaDescription: "About us", ...extra },
    rows: [{ id: "r1", style: {}, columns: [{ id: "c1", width: "100%", elements: [{ id: "e1", type: "heading", style: {}, attributes: { text } }] }] }],
  },
});

describe("moving a classic page over", () => {
  it("converts the design and keeps the page's search details", () => {
    const r = convertV1ToV2(v1("Hello"), { id: "t1", name: "Home", slug: null, isHome: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.design.format).toBe(V2_FORMAT);
    expect(r.design.pages).toHaveLength(1);
    expect(r.design.meta).toEqual({ htmlTitle: "Tab title", metaDescription: "About us" });
    expect(JSON.stringify(r.design)).toContain("Hello");
  });

  it("explains differences and left-out blocks in plain words", () => {
    const notes = describeConversion("partial", ["Bold, italic and links inside text are simplified to plain text.", "A video block had no video address, so it was left out.", "A video block had no video address, so it was left out."]);
    expect(notes.differs).toEqual(["Bold, italic and links inside text are simplified to plain text."]);
    expect(notes.missing).toEqual(["A video block had no video address, so it was left out."]);
    expect(describeConversion("exact", []).headline).toMatch(/as it is/);
  });

  it("only ordinary landing pages can move", () => {
    const ok = { kind: "LANDING_PAGE", sourceType: "BUILDER", designFormat: "v1" };
    expect(canMoveToV2(ok)).toBe(true);
    expect(canMoveToV2({ ...ok, designFormat: undefined })).toBe(true);
    expect(canMoveToV2({ ...ok, kind: "EMAIL" })).toBe(false);
    expect(canMoveToV2({ ...ok, sourceType: "RAW_UPLOAD" })).toBe(false);
    expect(canMoveToV2({ ...ok, sourceType: "REACT_PROJECT" })).toBe(false);
    expect(canMoveToV2({ ...ok, designFormat: "v2" })).toBe(false);
    expect(canMoveToV2({ ...ok, isSiteLayoutFragment: true })).toBe(false);
    expect(canMoveToV2({ ...ok, isBlogLayout: true })).toBe(false);
  });
});
