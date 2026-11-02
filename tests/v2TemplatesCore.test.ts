import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPageFromTemplate, createDefaultDesignSystem, ensureWorkspace, workspaceOf, type DocumentNode, type PageDefinition } from "@charisol/plexo-sdk/v2/compile";

import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { compileTemplate } from "@/lib/compileTemplate";
import { Template, TemplateRevision } from "@/lib/db/contentEntities";
import { spliceLayoutRows } from "@/lib/siteLayoutCore";
import { spliceLayoutSections } from "@/lib/v2/compile";
import { blankV2Design, defaultDesignFormat, designFormatOf, isV2Design, parseV2Design, V2DesignError, V2_FORMAT, v2DesignFromTemplate } from "@/lib/v2/design";
import { findV2Form, listV2Forms, relabelV2Fields } from "@/lib/v2/forms";
import { hasBlogMarker, substituteBlogMarkers } from "@/lib/pub/blogLayoutRender";
import { hasLivePostLists } from "@/lib/pub/blogLivePostLists";

// Entities are only used for their schema here (.params()), never to reach DynamoDB.
vi.hoisted(() => {
  for (const n of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${n}_TABLE`] ??= `test-${n}`;
});

const node = (type: string, props: Record<string, unknown>, id: string, name = id): DocumentNode =>
  ({ id, type, name, props, styles: { position: "absolute", x: 20, y: 20, width: "420px", height: "200px" } }) as DocumentNode;
const page = (...kids: DocumentNode[]): PageDefinition => ({
  id: "p1",
  name: "Home",
  slug: "home",
  isHome: true,
  rootNode: { id: "root", type: "page", name: "Page", styles: {}, children: [{ id: "s1", type: "section", name: "Section", styles: { minHeight: "600px", layoutMode: "free" }, children: kids }] },
});
const design = (p: PageDefinition, extra: Record<string, unknown> = {}) => ({ format: V2_FORMAT, pages: [p], ...extra });

const rich = page(
  node("accordion", { items: [{ title: "Why Plexo?", content: "Because." }] }, "acc"),
  node("video", { url: "https://youtu.be/dQw4w9WgXcQ" }, "vid"),
  node("form", { fields: [{ id: "f1", label: "Your name", type: "text" }, { id: "f2", label: "Email", type: "email" }], submitLabel: "Send" }, "contact", "Contact form"),
  node("blogContent", {}, "bc"),
  node("blogPostList", {}, "bpl"),
  node("shopGrid", { limit: 6 }, "shop"),
  node("signupForm", {}, "signup"),
);

describe("schema: designFormat", () => {
  it("defaults new Template and TemplateRevision rows... Template to v1, revision left alone", () => {
    const t = Template.create({ id: "a", userId: "u", organizationId: "o", name: "n", kind: "LANDING_PAGE", designJson: {}, compiledHtml: "" }).params() as { Item: Record<string, unknown> };
    expect(t.Item.designFormat).toBe("v1");
    const r = TemplateRevision.create({ id: "r", templateId: "a", designJson: {}, compiledHtml: "", sdkVersion: "x" }).params() as { Item: Record<string, unknown> };
    expect(r.Item.designFormat).toBeUndefined();
  });
  it("treats a missing format (rows from before the field existed) as v1", () => {
    expect(designFormatOf({})).toBe("v1");
    expect(designFormatOf({ designFormat: null })).toBe("v1");
    expect(designFormatOf(undefined)).toBe("v1");
    expect(designFormatOf({ designFormat: "v2" })).toBe("v2");
  });
});

describe("parseV2Design", () => {
  it("accepts a valid design and keeps designSystem/meta/customJs", () => {
    const r = parseV2Design(design(page(), { customJs: "console.log(1)", meta: { htmlTitle: " Hi ", favicon: "javascript:x", ogImageUrl: "https://a.test/i.png" } }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.design.meta).toEqual({ htmlTitle: "Hi", ogImageUrl: "https://a.test/i.png" });
      expect(r.design.customJs).toBe("console.log(1)");
    }
    expect(isV2Design(blankV2Design())).toBe(true);
    expect(isV2Design({ body: { rows: [] } })).toBe(false);
  });
  it("doesn't store the unchanged built-in design system (it is ~84 KB)", () => {
    const withDefault = parseV2Design({ ...blankV2Design(), designSystem: createDefaultDesignSystem() });
    expect(withDefault).toMatchObject({ ok: true });
    expect((withDefault as { design: { designSystem?: unknown } }).design.designSystem).toBeUndefined();
    const custom = createDefaultDesignSystem();
    custom.name = "Acme";
    const kept = parseV2Design({ ...blankV2Design(), designSystem: custom }) as { design: { designSystem?: { name: string } } };
    expect(kept.design.designSystem?.name).toBe("Acme");
  });
  it("keeps a design system brought in from Strata (thousands of tokens and variants) and a page far past the old 120 KB limit, and still refuses an absurd one", () => {
    const big = createDefaultDesignSystem();
    big.tokens = [...big.tokens, ...Array.from({ length: 1400 }, (_, i) => ({ key: `--color-strata-${i}`, name: `Strata ${i}`, value: "#123456", type: "color", unit: null, layer: "brand" as const, comment: "from Strata" }))];
    expect(JSON.stringify(big).length).toBeGreaterThan(120_000);
    expect(parseV2Design({ ...blankV2Design(), designSystem: big })).toMatchObject({ ok: true });
    const absurd = { ...big, tokens: [...big.tokens, ...Array.from({ length: 40_000 }, (_, i) => ({ ...big.tokens[0], key: `--x-${i}` }))] };
    expect((parseV2Design({ ...blankV2Design(), designSystem: absurd }) as { error: string }).error).toMatch(/larger than Plexo can save/);
  });
  it("rejects with plain messages", () => {
    expect(parseV2Design({ body: { rows: [] } })).toMatchObject({ ok: false });
    expect(parseV2Design({ format: V2_FORMAT, pages: [] })).toMatchObject({ ok: false });
    const two = parseV2Design({ format: V2_FORMAT, pages: [page(), { ...page(), id: "p2" }] });
    expect(two.ok).toBe(false);
    expect(parseV2Design(design({ ...page(), rootNode: { id: "r", type: "bogus", name: "x", styles: {} } as never }))).toMatchObject({ ok: false });
    const huge = parseV2Design(design(page(node("paragraph", { text: "x".repeat(5_100_000) }, "big"))));
    expect(huge).toMatchObject({ ok: false });
    expect((huge as { error: string }).error).toMatch(/larger than Plexo can save/);
  });
});

describe("the editor's canvas workspace (things parked beside the page)", () => {
  it("is saved with the page but never published, and its forms don't count as the page's", async () => {
    const text = (id: string, content: string): DocumentNode => ({ id, type: "paragraph", name: id, content, styles: {} }) as DocumentNode;
    const p = page(text("on", "On the page"));
    const withWs: PageDefinition = { ...p, rootNode: ensureWorkspace(p.rootNode) };
    workspaceOf(withWs.rootNode)!.children = [
      text("parked", "PARKED-SECRET"),
      node("form", { fields: [{ id: "f1", label: "Parked form", type: "text" }], submitLabel: "Send" }, "parkedform"),
    ];
    const parsed = parseV2Design(design(withWs));
    expect(parsed.ok).toBe(true);
    expect(JSON.stringify((parsed as { design: unknown }).design)).toContain("PARKED-SECRET"); // kept for the editor
    const html = await compileTemplate({ designFormat: "v2", designJson: design(withWs), kind: "LANDING_PAGE", id: "p1", name: "Home" });
    expect(html).toContain("On the page");
    expect(html).not.toContain("PARKED-SECRET");
    expect(html).not.toContain("Parked form");
  });
});

describe("TEMPLATES_V2_NEW flag", () => {
  const old = process.env.TEMPLATES_V2_NEW;
  afterEach(() => {
    if (old === undefined) delete process.env.TEMPLATES_V2_NEW;
    else process.env.TEMPLATES_V2_NEW = old;
  });
  it("is off by default and on for true/1", () => {
    delete process.env.TEMPLATES_V2_NEW;
    expect(defaultDesignFormat()).toBe("v1");
    process.env.TEMPLATES_V2_NEW = "false";
    expect(defaultDesignFormat()).toBe("v1");
    process.env.TEMPLATES_V2_NEW = "true";
    expect(defaultDesignFormat()).toBe("v2");
    process.env.TEMPLATES_V2_NEW = "1";
    expect(defaultDesignFormat()).toBe("v2");
  });
});

describe("compileTemplate dispatcher", () => {
  const v1Design = { body: { style: { background: "#fff", htmlTitle: "Hi" }, rows: [{ id: "r1", style: {}, columns: [{ id: "c1", width: "100%", elements: [{ id: "e1", type: "heading", content: "Hello", style: {}, attributes: {} }] }] }] } };

  it("v1 (and missing format) is exactly today's sanitizeHtml(compileToHTML())", async () => {
    const golden = sanitizeHtml(compileToHTML(v1Design));
    expect(await compileTemplate({ designJson: v1Design, kind: "LANDING_PAGE" })).toBe(golden);
    expect(await compileTemplate({ designFormat: "v1", designJson: v1Design, kind: "LANDING_PAGE" })).toBe(golden);
  });

  it("v2 compiles to a sanitised document that keeps what V1's sanitiser would strip", async () => {
    const html = await compileTemplate({ designFormat: "v2", designJson: design(rich), kind: "LANDING_PAGE", id: "site1", name: "My site" });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>My site</title>");
    expect(html).toContain("<details");
    expect(html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(html).not.toContain("onerror");
  });

  it("v2 email compiles to a real email document", async () => {
    const html = await compileTemplate({ designFormat: "v2", designJson: blankV2Design(), kind: "EMAIL" });
    expect(String(html)).toMatch(/^<!doctype html>/);
  });

  it("v2 bad design -> plain error", async () => {
    await expect(compileTemplate({ designFormat: "v2", designJson: { nope: 1 }, kind: "LANDING_PAGE" })).rejects.toThrow(/new editor's format/);
  });

  it("adds the owner's custom script after sanitising, and meta to the head", async () => {
    const html = await compileTemplate({
      designFormat: "v2",
      kind: "LANDING_PAGE",
      id: "s",
      name: "n",
      designJson: design(page(), { customJs: "window.hello=1; </script><b>", meta: { metaDescription: 'A "quote"', htmlTitle: "Tab" } }),
    });
    expect(html).toContain("window.hello=1;");
    expect(html).not.toContain("</script><b>");
    expect(html).toContain('<meta name="description" content="A &quot;quote&quot;">');
    expect(html).toContain("<title>Tab</title>");
    expect(html.indexOf("window.hello")).toBeLessThan(html.indexOf("</body>"));
  });

  it("a stored page script that isn't the owner's is stripped", async () => {
    const html = await compileTemplate({ designFormat: "v2", kind: "LANDING_PAGE", id: "s", name: "n", designJson: design(page(node("html", { code: "<script>steal()</script><p>ok</p>" }, "emb"))) });
    expect(html).not.toContain("steal()</script><p>ok</p>");
  });
});

describe("v2 output feeds the server's marker substitution", () => {
  it("blog / commerce / funnel markers survive compile + sanitise unchanged", async () => {
    const html = await compileTemplate({ designFormat: "v2", designJson: design(rich), kind: "LANDING_PAGE", id: "site1", name: "n" });
    expect(hasBlogMarker(html, "content")).toBe(true);
    expect(hasBlogMarker(html, "postList")).toBe(true);
    const filled = substituteBlogMarkers(html, { content: "<article>REAL POST</article>", postList: "<ul>REAL LIST</ul>" });
    expect(filled).toContain("<article>REAL POST</article>");
    expect(filled).toContain("<ul>REAL LIST</ul>");
    expect(filled).not.toMatch(/data-plexo-blog-content="true"[^>]*><\/div>/);
    expect(html).toContain("data-plexo-commerce-shopGrid");
    expect(html).toContain('data-plexo-commerce-limit="6"');
    // The pub route's LMS gate and live-post-list gate read the same HTML.
    expect(html.includes("data-plexo-lms-signup")).toBe(true);
    expect(hasLivePostLists(html)).toBe(false);
  });
});

describe("forms in v2 designs", () => {
  it("compiled form posts to Plexo's inbox for the SITE, with the honeypot and a traceable address", async () => {
    const html = await compileTemplate({ designFormat: "v2", designJson: design(rich), kind: "LANDING_PAGE", id: "page9", name: "n" }, { rootTemplateId: "root7" });
    expect(html).toContain('name="_hp_field"');
    expect(html).toContain('action="/api/public/forms/root7/submit?form=Contact%20form&amp;page=page9&amp;fid=contact"');
    expect(html).toContain('name="f1"');
  });
  it("finds forms and restores labels", () => {
    const d = design(rich);
    const forms = listV2Forms(d);
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({ nodeId: "contact", name: "Contact form" });
    expect(findV2Form(d, "nope")).toBeNull();
    expect(listV2Forms({ body: { rows: [] } })).toEqual([]);
    expect(relabelV2Fields({ f1: "Ada", f2: "a@b.co", extra: "x" }, forms[0])).toEqual({ "Your name": "Ada", Email: "a@b.co", extra: "x" });
  });
});

describe("site layout splicing", () => {
  it("v2: header sections first, footer last, page untouched, ids kept unique", () => {
    const own = parseV2Design(design(page(node("paragraph", {}, "own")))) as { ok: true; design: ReturnType<typeof blankV2Design> };
    const sec = (id: string): DocumentNode => ({ id, type: "section", name: id, styles: {}, children: [] }) as DocumentNode;
    const spliced = spliceLayoutSections(own.design, { headerSections: [sec("h1"), sec("s1")], footerSections: [sec("f1")] });
    const ids = spliced.pages[0].rootNode.children!.map((c) => c.id);
    expect(ids).toEqual(["h1", "hdr-s1", "s1", "f1"]);
    expect(own.design.pages[0].rootNode.children).toHaveLength(1); // original not mutated
    expect(spliceLayoutSections(own.design, null)).toBe(own.design);
  });
  it("v1: rows spliced as before", () => {
    const d = { body: { rows: [{ id: "own" }] } };
    const out = spliceLayoutRows(d, { headerRows: [{ id: "h" }], footerRows: [{ id: "f" }] });
    expect(out.body.rows.map((r: { id: string }) => r.id)).toEqual(["h", "own", "f"]);
    expect(spliceLayoutRows(d, null)).toBe(d);
  });
});

describe("page templates", () => {
  it("a page started from a template is a valid, compilable design", async () => {
    const d = v2DesignFromTemplate("pricing", { name: "Pricing", slug: "pricing", seed: "abc" });
    expect(parseV2Design(d)).toMatchObject({ ok: true });
    expect(buildPageFromTemplate).toBeTypeOf("function");
    const html = await compileTemplate({ designFormat: "v2", designJson: d, kind: "LANDING_PAGE", id: "x", name: "Pricing" });
    expect(html.length).toBeGreaterThan(1000);
  });
});
