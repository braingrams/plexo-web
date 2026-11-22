import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentNode } from "@charisol/plexo-sdk/v2/compile";

// The whole "turn a block page into code" flow against in-memory stand-ins for the database, with the REAL page build
// (classic compiler and new-editor compiler), the real header/footer splice and the real brand link.
const h = vi.hoisted(() => ({
  templates: new Map<string, Record<string, any>>(),
  revisions: [] as Record<string, any>[],
  layout: null as null | Record<string, any>,
  domains: [{ id: "d1" }] as Record<string, any>[],
  brand: null as null | { revision: string; mapping: null; serverInject: false },
  role: null as string | null,
  org: "o",
}));

vi.mock("@/lib/db/client", () => ({ TABLES: { content: "content" }, docClient: { send: vi.fn() } }));
vi.mock("@/lib/db/contentEntities", () => {
  const patchable = (id: string) => {
    const set: Record<string, any> = {};
    const removed: string[] = [];
    const b: any = {
      set(v: Record<string, any>) { Object.assign(set, v); return b; },
      remove(keys: string[]) { removed.push(...keys); return b; },
      where() { return b; },
      go: async () => {
        const row = h.templates.get(id);
        if (row) { Object.assign(row, set); for (const k of removed) delete row[k]; }
        return { data: row };
      },
    };
    return b;
  };
  return {
    Template: {
      get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.templates.get(id) ?? null }) }),
      patch: ({ id }: { id: string }) => patchable(id),
      query: { byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.parentId === parentId) }) }) },
      scan: { where: () => ({ go: async () => ({ data: [] }) }) },
    },
    TemplateRevision: {
      create: (row: Record<string, any>) => ({ go: async () => { h.revisions.push({ createdAt: new Date().toISOString(), ...row }); return { data: row }; } }),
      query: { primary: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.revisions.filter((r) => r.templateId === templateId).reverse() }) }) },
      remove: ({ id }: { id: string }) => ({ go: async () => { h.revisions = h.revisions.filter((r) => r.id !== id); return {}; } }),
    },
    PublishedDomain: { query: { primary: () => ({ go: async () => ({ data: h.domains }) }) } },
    SiteLayout: { get: () => ({ go: async () => ({ data: h.layout }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
    BlogSite: { get: () => ({ go: async () => ({ data: null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
  };
});
vi.mock("@/lib/db/commerceEntities", () => ({
  CommerceSettings: { get: () => ({ go: async () => ({ data: null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/db/coreEntities", () => ({ Member: { get: () => ({ go: async () => ({ data: { role: "owner" } }) }) } }));
vi.mock("@/lib/brand/siteBrand", () => ({ brandForServing: async () => h.brand, linkedDesignSystem: async () => null }));
vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u", organizationId: h.org, role: h.role, subscriptionPlan: "ULTRA" }) }));
vi.mock("@/server/requirePermissionDynamo", () => ({ requirePermission: () => null }));
vi.mock("@/server/requireTemplateScope", () => ({ requireTemplateScope: () => null }));
vi.mock("@/server/slugDynamo", () => ({ isValidUuid: (id: string) => id !== "bad" }));

import { renderBlockPageAsHtml, ConvertError } from "@/lib/editorModes/convertPage";
import { POST as convert } from "@/app/api/templates/[id]/convert-to-code/route";
import { POST as restore } from "@/app/api/templates/[id]/restore-blocks/route";
import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { injectCustomJs } from "@/lib/pub/htmlInject";
import { normalizeHtml } from "@/lib/editorModes/convertToCode";
import { lintHtml } from "@/lib/editorModes/htmlLint";
import { formatHtml } from "@/lib/editorModes/htmlFormat";
import { V2_FORMAT } from "@/lib/v2/design";
import { compileTemplateWithSiteLayout } from "@/lib/siteLayoutCore";

const sec = (id: string, text: string, extra: DocumentNode[] = []): DocumentNode =>
  ({ id, type: "section", name: id, styles: { minHeight: "80px", layoutMode: "free" }, children: [{ id: `${id}-t`, type: "heading", name: "t", content: text, styles: { position: "absolute", x: 10, y: 10, width: "200px", height: "40px" } }, ...extra] }) as DocumentNode;
const v2Page = (name: string, ...sections: DocumentNode[]) => ({ format: V2_FORMAT, pages: [{ id: `pg-${name}`, name, slug: name, rootNode: { id: `root-${name}`, type: "page", name, styles: {}, children: sections } }] });
const v1Design = (text: string, customJs?: string) => ({
  body: { style: { background: "#fff", ...(customJs ? { customJs } : {}) }, rows: [{ id: `r-${text}`, style: {}, columns: [{ id: `c-${text}`, width: "100%", elements: [{ id: `e-${text}`, type: "heading", style: {}, attributes: { text } }] }] }] },
});
const base = { userId: "u", organizationId: "o", kind: "LANDING_PAGE", sourceType: "BUILDER" };

const call = (fn: typeof convert, id: string, body: unknown = {}) =>
  fn(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) });

/** The page as it is stored when it has been built and published: designJson + the compiled page that is served. */
async function stored(id: string, row: Record<string, any>): Promise<Record<string, any>> {
  const t: Record<string, any> = { ...base, name: id, ...row, id };
  h.templates.set(id, t);
  t.compiledHtml = await compileTemplateWithSiteLayout(t as never, t.designJson);
  // The row in the "database" gets changed by the flows under test, so hand back a snapshot of how it started.
  return structuredClone(t);
}

beforeEach(() => {
  h.templates.clear();
  h.revisions = [];
  h.layout = null;
  h.domains = [{ id: "d1" }];
  h.brand = null;
  h.role = null;
  h.org = "o";
});

describe("a classic (block) page becomes code that is the same page", () => {
  it("live page with header, footer and its own script: same page visitors get, script written in", async () => {
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designJson: v1Design("HEADTEXT"), compiledHtml: "" });
    h.templates.set("ftr", { ...base, id: "ftr", name: "Footer", isSiteLayoutFragment: true, designJson: v1Design("FOOTTEXT"), compiledHtml: "" });
    h.layout = { templateId: "root", enabled: true, headerTemplateId: "hdr", footerTemplateId: "ftr" };
    const page = await stored("root", { designJson: v1Design("BODYTEXT", "window.hello = 1;") });
    const r = await renderBlockPageAsHtml(page as never, "live");
    // What visitors get from the block page today: the build, then the script added as it is served.
    expect(r.html).toBe(injectCustomJs(page.compiledHtml, "window.hello = 1;"));
    expect(normalizeHtml(r.html)).toContain("window.hello = 1;");
    expect(r.html.indexOf("HEADTEXT")).toBeLessThan(r.html.indexOf("BODYTEXT"));
    expect(r.html.indexOf("BODYTEXT")).toBeLessThan(r.html.indexOf("FOOTTEXT"));
    expect(r).toMatchObject({ hasHeader: true, hasFooter: true, hasOwnScript: true, isLive: true, usedWorkingCopy: false, hasUnpublishedChanges: false });
  });

  it("the page's own Show header / Show footer switches are honoured", async () => {
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designJson: v1Design("HEADTEXT"), compiledHtml: "" });
    h.layout = { templateId: "root", enabled: true, headerTemplateId: "hdr" };
    const page = await stored("root", { designJson: v1Design("BODYTEXT"), hideHeader: true });
    const r = await renderBlockPageAsHtml(page as never, "live");
    expect(r.html).not.toContain("HEADTEXT");
    expect(r.hasHeader).toBe(false);
  });

  it("a working copy that was never published is built the way Publish builds it, and it is the code when asked for", async () => {
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designJson: v1Design("HEAD"), compiledHtml: "" });
    h.layout = { templateId: "root", enabled: true, headerTemplateId: "hdr" };
    const page = await stored("root", { designJson: v1Design("LIVE"), draftJson: v1Design("WORKING", "w()") });
    const working = await renderBlockPageAsHtml(page as never, "working");
    const spliced = { ...v1Design("WORKING", "w()"), body: { ...v1Design("WORKING", "w()").body, rows: [...v1Design("HEAD").body.rows, ...v1Design("WORKING").body.rows] } };
    expect(working.html).toBe(injectCustomJs(sanitizeHtml(compileToHTML(spliced)), "w()"));
    expect(working).toMatchObject({ usedWorkingCopy: true, hasUnpublishedChanges: true });
    const live = await renderBlockPageAsHtml(page as never, "live");
    expect(live.html).toContain("LIVE");
    expect(live.html).not.toContain("WORKING");
    expect(live).toMatchObject({ usedWorkingCopy: false, hasUnpublishedChanges: true });
  });

  it("asking for the working copy when there is no draft gives the live page", async () => {
    const page = await stored("root", { designJson: v1Design("ONLY") });
    expect((await renderBlockPageAsHtml(page as never, "working")).html).toBe(page.compiledHtml);
  });

  it("says a page that isn't on a domain isn't live", async () => {
    h.domains = [];
    const page = await stored("root", { designJson: v1Design("X") });
    expect((await renderBlockPageAsHtml(page as never, "live")).isLive).toBe(false);
    h.domains = [{ id: "d" }];
    h.templates.set("kid", { ...base, id: "kid", parentId: "root", name: "K", isPublished: false, designJson: v1Design("K"), compiledHtml: "<p>K</p>" });
    expect((await renderBlockPageAsHtml(h.templates.get("kid") as never, "live")).isLive).toBe(false);
  });

  it("refuses a page with nothing built yet, in plain words", async () => {
    h.templates.set("blank", { ...base, id: "blank", name: "Blank", designJson: v1Design("x"), compiledHtml: "   " });
    const attempt = renderBlockPageAsHtml(h.templates.get("blank") as never, "live");
    await expect(attempt).rejects.toThrow(ConvertError);
    await expect(attempt).rejects.toThrow(/nothing on it yet/);
  });
});

describe("a new-editor (v2) page becomes code that is the same page", () => {
  it("keeps the header and footer in their places, the form's address, and adds the brand once", async () => {
    h.brand = { revision: "r7", mapping: null, serverInject: false };
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designFormat: "v2", designJson: v2Page("Header", sec("hs", "HEADERTEXT")), compiledHtml: "" });
    h.layout = { templateId: "root", enabled: true, headerTemplateId: "hdr" };
    h.templates.set("root", { ...base, id: "root", name: "Home", designFormat: "v2", designJson: v2Page("Home", sec("own", "BODYTEXT")), compiledHtml: "" });
    const form = { id: "frm", type: "form", name: "Contact", props: { fields: [{ id: "f1", label: "Name", type: "text" }] }, styles: { position: "absolute", x: 0, y: 0, width: "300px", height: "200px" } } as DocumentNode;
    const kid = await stored("kid", { parentId: "root", designFormat: "v2", designJson: v2Page("Contact", sec("ks", "KIDTEXT", [form])) });
    const r = await renderBlockPageAsHtml(kid as never, "live");
    expect(r.html.indexOf("HEADERTEXT")).toBeLessThan(r.html.indexOf("KIDTEXT"));
    expect(r.html).toContain("/api/public/forms/root/submit?form=Contact&amp;page=kid&amp;fid=frm");
    expect(r.html.match(/data-plexo-brand/g)).toHaveLength(1);
    expect(r.html).toContain('href="/__plexo/brand/root.css"');
    expect(r.html).not.toContain("?v=");
    // Take the one added link (and the font preconnect tags that go with it) out and it is exactly the page that was built.
    expect(r.html.replace(/(<link rel="preconnect"[^>]*>)+<link [^>]*data-plexo-brand>/, "")).toBe(kid.compiledHtml);
    expect(r).toMatchObject({ hasHeader: true, hasFooter: false, hasOwnScript: false });
    // What the owner opens in Code is healthy: no false alarms, and Tidy up keeps it the same page.
    expect(lintHtml(r.html).filter((p) => p.severity === "error")).toEqual([]);
    expect(normalizeHtml(formatHtml(r.html))).toBe(normalizeHtml(r.html));
  });

  it("does not add a brand link when the site has no brand", async () => {
    const page = await stored("root", { designFormat: "v2", designJson: v2Page("Home", sec("own", "BODYTEXT")) });
    const r = await renderBlockPageAsHtml(page as never, "live");
    expect(r.html).toBe(page.compiledHtml);
  });
});

describe("POST /api/templates/:id/convert-to-code", () => {
  it("preview changes nothing and says what comes along", async () => {
    const page = await stored("root", { designJson: v1Design("HELLO"), draftJson: v1Design("DRAFT") });
    const res = await call(convert, "root", { preview: true });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.html).toContain("DRAFT");
    expect(json).toMatchObject({ hasUnpublishedChanges: true, isLive: true });
    expect(json.notes.copied.length).toBeGreaterThan(0);
    expect(h.revisions).toEqual([]);
    expect(h.templates.get("root")!.sourceType).toBe("BUILDER");
    expect(h.templates.get("root")!.compiledHtml).toBe(page.compiledHtml);
  });

  it("converts: saves a backup first, then switches the page to code with exactly the previewed page", async () => {
    const page = await stored("root", { designJson: v1Design("HELLO", "go()"), draftJson: v1Design("DRAFT"), draftHtml: "<p>draft</p>" });
    const preview = await (await call(convert, "root", { preview: true })).json();
    const res = await call(convert, "root", {});
    expect(res.status).toBe(200);
    const row = h.templates.get("root")!;
    expect(row.sourceType).toBe("RAW_UPLOAD");
    expect(row.compiledHtml).toBe(preview.html);
    expect(row.draftJson).toBeUndefined();
    expect(row.draftHtml).toBeUndefined();
    expect(row.blocksBackupId).toBeTruthy();
    expect(row.convertedFromBlocksAt).toBeTruthy();
    const backup = h.revisions.find((r) => r.id === row.blocksBackupId)!;
    expect(backup).toMatchObject({ templateId: "root", designFormat: "v1", authorName: "Before turning into code" });
    expect(backup.designJson).toEqual(page.designJson);
    expect(backup.compiledHtml).toBe(page.compiledHtml);
    expect(backup.draftJson).toEqual(v1Design("DRAFT"));
    expect(row.designJson).toEqual(page.designJson);
  });

  it("keeps what is live when asked, and still saves the working copy in the backup", async () => {
    const page = await stored("root", { designJson: v1Design("LIVEWORDS"), draftJson: v1Design("DRAFTWORDS") });
    await call(convert, "root", { source: "live" });
    const row = h.templates.get("root")!;
    expect(row.compiledHtml).toBe(page.compiledHtml);
    expect(h.revisions[0].draftJson).toEqual(v1Design("DRAFTWORDS"));
  });

  it("refuses what can't be converted, with the reason", async () => {
    await stored("root", { designJson: v1Design("X") });
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designJson: v1Design("H"), compiledHtml: "<p>h</p>" });
    h.templates.set("mail", { ...base, id: "mail", name: "Mail", kind: "EMAIL", designJson: v1Design("M"), compiledHtml: "<p>m</p>" });
    h.templates.set("raw", { ...base, id: "raw", name: "Raw", sourceType: "RAW_UPLOAD", designJson: {}, compiledHtml: "<p>r</p>" });
    for (const [id, text] of [["hdr", /shared by other pages/], ["mail", /Emails/], ["raw", /already code/]] as const) {
      const res = await call(convert, id, {});
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(text);
    }
    expect(h.revisions).toEqual([]);
  });

  it("is not available for another account's page, a bad id, or twice", async () => {
    await stored("root", { designJson: v1Design("X") });
    h.org = "someone-else";
    expect((await call(convert, "root", {})).status).toBe(404);
    h.org = "o";
    expect((await call(convert, "bad", {})).status).toBe(404);
    expect((await call(convert, "root", {})).status).toBe(200);
    const again = await call(convert, "root", {});
    expect(again.status).toBe(400);
    expect(h.revisions).toHaveLength(1);
  });
});

describe("POST /api/templates/:id/restore-blocks", () => {
  it("goes back to the blocks, working copy included, with today's header and footer", async () => {
    const page = await stored("root", { designJson: v1Design("BLOCKS"), draftJson: v1Design("DRAFTBLOCKS"), draftHtml: "<p>d</p>" });
    await call(convert, "root", { source: "working" });
    // the owner edits the code, then changes the site header, then goes back
    h.templates.get("root")!.compiledHtml = "<p>my own code</p>";
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designJson: v1Design("NEWHEADER"), compiledHtml: "" });
    h.layout = { templateId: "root", enabled: true, headerTemplateId: "hdr" };
    const res = await call(restore, "root", {});
    expect(res.status).toBe(200);
    const row = h.templates.get("root")!;
    expect(row.sourceType).toBe("BUILDER");
    expect(row.designJson).toEqual(page.designJson);
    expect(row.draftJson).toEqual(v1Design("DRAFTBLOCKS"));
    expect(row.compiledHtml).toContain("BLOCKS");
    expect(row.compiledHtml).toContain("NEWHEADER");
    expect(row.blocksBackupId).toBeUndefined();
    expect(row.convertedFromBlocksAt).toBeUndefined();
  });

  it("a page with no draft comes back with no draft", async () => {
    await stored("root", { designJson: v1Design("PLAIN") });
    await call(convert, "root", {});
    await call(restore, "root", {});
    expect(h.templates.get("root")!.draftJson).toBeUndefined();
    expect(h.templates.get("root")!.sourceType).toBe("BUILDER");
  });

  it("a v2 page goes back as v2", async () => {
    const page = await stored("root", { designFormat: "v2", designJson: v2Page("Home", sec("own", "V2WORDS")) });
    await call(convert, "root", {});
    expect(h.templates.get("root")!.designFormat).toBe("v2");
    await call(restore, "root", {});
    const row = h.templates.get("root")!;
    expect(row).toMatchObject({ sourceType: "BUILDER", designFormat: "v2" });
    expect(row.compiledHtml).toBe(page.compiledHtml);
  });

  it("says so when there is nothing to go back to or the backup is gone", async () => {
    await stored("root", { designJson: v1Design("X") });
    expect((await call(restore, "root", {})).status).toBe(409);
    await call(convert, "root", {});
    h.revisions = [];
    const res = await call(restore, "root", {});
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no longer saved/);
    expect(h.templates.get("root")!.sourceType).toBe("RAW_UPLOAD");
  });
});

describe("errors in plain words", () => {
  it("ConvertError messages are written for the owner", () => {
    expect(new ConvertError("x")).toBeInstanceOf(Error);
  });
});
