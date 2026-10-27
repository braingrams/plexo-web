import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const db = { templates: [] as Row[], assets: [] as Row[], uploaded: [] as string[], deleted: [] as string[] };
const blobs: Record<string, string> = {};

vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    query: { byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: db.templates.filter((t) => t.parentId === parentId) }) }) },
    create: (row: Row) => ({ go: async () => { db.templates.push({ ...row }); return { data: row }; } }),
    patch: ({ id }: { id: string }) => ({ set: (v: Row) => ({ go: async () => { Object.assign(db.templates.find((t) => t.id === id)!, v); return {}; } }) }),
  },
  TemplateAsset: {
    query: { primary: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: db.assets.filter((a) => a.templateId === templateId) }) }) },
    create: (row: Row) => ({ go: async () => { db.assets.push({ ...row }); return { data: row }; } }),
    remove: ({ templateId, path }: { templateId: string; path: string }) => ({ go: async () => { db.assets = db.assets.filter((a) => !(a.templateId === templateId && a.path === path)); return {}; } }),
  },
}));
vi.mock("@/lib/storage", () => ({
  uploadObject: async (key: string, buf: Buffer) => { const url = `https://blob/${key}`; blobs[url] = buf.toString("utf8"); db.uploaded.push(key); return { url }; },
  deleteObjects: async (urls: string | string[]) => { db.deleted.push(...[urls].flat()); },
}));

import { pageNameFromHtml, pageSlugFromFilename, splitHtmlAssetsIntoPages } from "@/lib/rawSite/splitPages";

const root = { id: "root", userId: "u", organizationId: "o", sourceType: "RAW_UPLOAD", kind: "LANDING_PAGE" };
const addAsset = (path: string, content: string, contentType = "text/html") => {
  const blobUrl = `https://blob/raw-sites/root/${path}`;
  blobs[blobUrl] = content;
  db.assets.push({ templateId: "root", path, blobUrl, contentType, size: content.length });
};

beforeEach(() => {
  db.templates = []; db.assets = []; db.uploaded = []; db.deleted = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: url in blobs, status: url in blobs ? 200 : 404, arrayBuffer: async () => Buffer.from(blobs[url] ?? "") })));
});

describe("naming", () => {
  it("names pages from the <title> without the site name, falling back to the file name", () => {
    expect(pageNameFromHtml("<title>About Us | Serenity Pas Senior Solutions</title>", "about.html")).toBe("About Us");
    expect(pageNameFromHtml("<html></html>", "our-businesses.html")).toBe("Our Businesses");
  });
  it("keeps the address the file already had", () => {
    expect(pageSlugFromFilename("businesses.html")).toBe("businesses");
    expect(pageSlugFromFilename("How It Works.htm")).toBe("how-it-works");
  });
});

describe("splitHtmlAssetsIntoPages", () => {
  it("turns loose .html files into pages at the same address, with the shared files copied, and removes the loose copies", async () => {
    addAsset("about.html", "<title>About Us | Site</title><h1>About</h1>");
    addAsset("contact.html", "<title>Contact Us | Site</title><form></form>");
    addAsset("style.css", "body{}", "text/css");
    addAsset("blog/post.html", "<h1>nested</h1>"); // nested files are partials, left alone

    const result = await splitHtmlAssetsIntoPages(root);

    expect(result.created.map((p) => [p.name, p.slug])).toEqual([["About Us", "about"], ["Contact Us", "contact"]]);
    const kids = db.templates.filter((t) => t.parentId === "root");
    expect(kids).toHaveLength(2);
    expect(kids.every((k) => k.sourceType === "RAW_UPLOAD" && k.kind === "LANDING_PAGE")).toBe(true);
    expect(kids[0].compiledHtml).toContain("<h1>About</h1>");
    expect(kids.map((k) => k.order)).toEqual([0, 1]);
    // each page has its own copy of style.css
    for (const k of kids) expect(db.assets.some((a) => a.templateId === k.id && a.path === "style.css")).toBe(true);
    // loose copies gone from the home page, shared + nested files stay
    expect(db.assets.filter((a) => a.templateId === "root").map((a) => a.path).sort()).toEqual(["blog/post.html", "style.css"]);
    expect(db.deleted).toHaveLength(2);
  });

  it("is safe to run again: an existing page is updated, never duplicated", async () => {
    addAsset("about.html", "<title>About | Site</title>v1");
    await splitHtmlAssetsIntoPages(root);
    addAsset("about.html", "<title>About | Site</title>v2");
    const again = await splitHtmlAssetsIntoPages(root);
    expect(again.created).toEqual([]);
    expect(again.updated.map((p) => p.slug)).toEqual(["about"]);
    expect(db.templates.filter((t) => t.parentId === "root")).toHaveLength(1);
    expect(db.templates.find((t) => t.slug === "about")!.compiledHtml).toContain("v2");
  });

  it("never overwrites a designed (builder) page that already uses the address", async () => {
    db.templates.push({ id: "b", parentId: "root", slug: "about", sourceType: "BUILDER", name: "About" });
    addAsset("about.html", "<h1>x</h1>");
    const result = await splitHtmlAssetsIntoPages(root);
    expect(result.created).toEqual([]);
    expect(result.skipped[0]).toContain("about.html");
    expect(db.assets.some((a) => a.path === "about.html")).toBe(true);
  });

  it("does nothing for sub-pages, non-raw sites, or sites without loose pages", async () => {
    addAsset("about.html", "<h1>x</h1>");
    expect((await splitHtmlAssetsIntoPages({ ...root, parentId: "p" })).created).toEqual([]);
    expect((await splitHtmlAssetsIntoPages({ ...root, sourceType: "BUILDER" })).created).toEqual([]);
    db.assets = [];
    expect((await splitHtmlAssetsIntoPages(root)).created).toEqual([]);
  });

  it("leaves a file as it was if it cannot be read", async () => {
    db.assets.push({ templateId: "root", path: "gone.html", blobUrl: "https://blob/missing", contentType: "text/html", size: 1 });
    const result = await splitHtmlAssetsIntoPages(root);
    expect(result.created).toEqual([]);
    expect(result.skipped[0]).toContain("gone.html");
    expect(db.assets.some((a) => a.path === "gone.html")).toBe(true);
  });
});
