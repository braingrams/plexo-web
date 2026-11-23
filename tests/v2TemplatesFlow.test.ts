import { issueHumanCheck } from "@/lib/forms/humanCheck";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentNode } from "@charisol/plexo-sdk/v2/compile";

// In-memory stand-ins for the entities the flows touch.
const h = vi.hoisted(() => ({
  templates: new Map<string, Record<string, any>>(),
  revisions: [] as Record<string, any>[],
  layout: null as null | Record<string, any>,
  sent: [] as any[],
  submissions: [] as any[],
}));

vi.mock("@/lib/db/client", () => ({
  TABLES: { content: "content", commerce: "commerce", ops: "ops", import: "import" },
  docClient: { send: vi.fn(async (cmd: any) => void h.sent.push(cmd)) },
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({ TransactWriteCommand: class { constructor(public input: unknown) {} } }));

const patchable = (id: string) => {
  const set: Record<string, any> = {};
  const removed: string[] = [];
  const b: any = {
    set(v: Record<string, any>) { Object.assign(set, v); return b; },
    remove(keys: string[]) { removed.push(...keys); return b; },
    params: () => ({ id, set, removed }),
    go: async () => {
      const row = h.templates.get(id);
      if (row) { Object.assign(row, set); for (const k of removed) delete row[k]; }
      return { data: row };
    },
  };
  return b;
};
vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.templates.get(id) ?? null }) }),
    patch: ({ id }: { id: string }) => patchable(id),
    create: (row: Record<string, any>) => ({ go: async () => { h.templates.set(row.id, { designFormat: "v1", ...row }); return { data: row }; } }),
    query: {
      byParent: ({ parentId }: { parentId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.parentId === parentId) }) }),
      byOrg: ({ organizationId }: { organizationId: string }) => ({ go: async () => ({ data: [...h.templates.values()].filter((t) => t.organizationId === organizationId) }) }),
    },
    scan: { where: () => ({ go: async () => ({ data: [] }) }) },
  },
  TemplateRevision: {
    create: (row: Record<string, any>) => ({ params: () => { h.revisions.push(row); return row; }, go: async () => { h.revisions.push(row); return { data: row }; } }),
    query: { primary: () => ({ go: async () => ({ data: [...h.revisions].reverse() }) }) },
    remove: () => ({ go: async () => ({}) }),
  },
  SiteLayout: { get: () => ({ go: async () => ({ data: h.layout }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
  BlogSite: { get: () => ({ go: async () => ({ data: null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/db/commerceEntities", () => ({
  CommerceSettings: { get: () => ({ go: async () => ({ data: null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
}));

import { recompileSiteLayoutDependents } from "@/lib/siteLayoutCore";
import { restoreTemplateVersion, publishTemplateDraft } from "@/lib/templateVersions";
import { snapshotTemplateRevision } from "@/lib/templateRevisions";
import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { V2_FORMAT } from "@/lib/v2/design";

const sec = (id: string, text: string): DocumentNode =>
  ({ id, type: "section", name: id, styles: { minHeight: "80px", layoutMode: "free" }, children: [{ id: `${id}-t`, type: "heading", name: "t", content: text, styles: { position: "absolute", x: 10, y: 10, width: "200px", height: "40px" } }] }) as DocumentNode;
const v2Page = (name: string, ...sections: DocumentNode[]) => ({
  format: V2_FORMAT,
  pages: [{ id: `pg-${name}`, name, slug: name, rootNode: { id: `root-${name}`, type: "page", name, styles: {}, children: sections } }],
});
const v1Design = (text: string) => ({
  body: { style: { background: "#fff" }, rows: [{ id: `r-${text}`, style: {}, columns: [{ id: `c-${text}`, width: "100%", elements: [{ id: `e-${text}`, type: "heading", style: {}, attributes: { text } }] }] }] },
});
const base = { userId: "u", organizationId: "o", kind: "LANDING_PAGE", sourceType: "BUILDER", compiledHtml: "" };

beforeEach(() => {
  h.templates.clear();
  h.revisions.length = 0;
  h.sent.length = 0;
  h.layout = null;
});

describe("site header/footer: recompile dependents", () => {
  it("v2 site: header/footer sections wrap the page; stored page JSON never contains them", async () => {
    h.templates.set("root", { ...base, id: "root", name: "Home", designFormat: "v2", designJson: v2Page("Home", sec("own", "BODYTEXT")) });
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designFormat: "v2", designJson: v2Page("Header", sec("hs", "HEADERTEXT")) });
    h.templates.set("ftr", { ...base, id: "ftr", name: "Footer", isSiteLayoutFragment: true, designFormat: "v2", designJson: v2Page("Footer", sec("fs", "FOOTERTEXT")) });
    h.layout = { templateId: "root", enabled: true, headerTemplateId: "hdr", footerTemplateId: "ftr" };

    await recompileSiteLayoutDependents("root");
    const html = h.templates.get("root")!.compiledHtml as string;
    expect(html.indexOf("HEADERTEXT")).toBeGreaterThan(-1);
    expect(html.indexOf("HEADERTEXT")).toBeLessThan(html.indexOf("BODYTEXT"));
    expect(html.indexOf("BODYTEXT")).toBeLessThan(html.indexOf("FOOTERTEXT"));
    expect(JSON.stringify(h.templates.get("root")!.designJson)).not.toContain("HEADERTEXT");
    // layout fragments are never compiled as pages
    expect(h.templates.get("hdr")!.compiledHtml).toBe("");
  });

  it("v2 page on a site whose header is still classic: the header is converted, not lost", async () => {
    h.templates.set("root", { ...base, id: "root", name: "Home", designFormat: "v2", designJson: v2Page("Home", sec("own", "BODYTEXT")) });
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designJson: v1Design("OLDHEADER") });
    h.layout = { templateId: "root", enabled: true, headerTemplateId: "hdr" };
    await recompileSiteLayoutDependents("root");
    const html = h.templates.get("root")!.compiledHtml as string;
    expect(html).toContain("OLDHEADER");
    expect(html.indexOf("OLDHEADER")).toBeLessThan(html.indexOf("BODYTEXT"));
  });

  it("v1 site: rows spliced exactly as before (golden)", async () => {
    h.templates.set("root", { ...base, id: "root", name: "Home", designJson: v1Design("BODY") });
    h.templates.set("hdr", { ...base, id: "hdr", name: "Header", isSiteLayoutFragment: true, designJson: v1Design("HEAD") });
    h.layout = { templateId: "root", enabled: true, headerTemplateId: "hdr" };
    await recompileSiteLayoutDependents("root");
    const spliced = { ...v1Design("BODY"), body: { ...v1Design("BODY").body, rows: [...v1Design("HEAD").body.rows, ...v1Design("BODY").body.rows] } };
    expect(h.templates.get("root")!.compiledHtml).toBe(sanitizeHtml(compileToHTML(spliced)));
  });

  it("a v2 child page's forms post to the SITE root, not the child", async () => {
    h.templates.set("root", { ...base, id: "root", name: "Home", designFormat: "v2", designJson: v2Page("Home", sec("own", "x")) });
    const form = { id: "frm", type: "form", name: "Contact", props: { fields: [{ id: "f1", label: "Name", type: "text" }] }, styles: { position: "absolute", x: 0, y: 0, width: "300px", height: "200px" } } as DocumentNode;
    h.templates.set("kid", { ...base, id: "kid", parentId: "root", name: "Contact", designFormat: "v2", designJson: v2Page("Contact", { ...sec("ks", "k"), children: [form] } as DocumentNode) });
    await recompileSiteLayoutDependents("root");
    expect(h.templates.get("kid")!.compiledHtml).toContain("/api/public/forms/root/submit?form=Contact&amp;page=kid&amp;fid=frm");
  });
});

describe("revisions keep the format with the design", () => {
  it("snapshot records the format; a v1 row without one is v1", async () => {
    await snapshotTemplateRevision({ id: "t", designJson: {}, compiledHtml: "" });
    await snapshotTemplateRevision({ id: "t", designFormat: "v2", designJson: v2Page("x"), compiledHtml: "" });
    expect(h.revisions.map((r) => r.designFormat)).toEqual(["v1", "v2"]);
  });

  it("restoring a v1 revision onto a page that is now v2 puts the label back with the JSON (and the reverse)", async () => {
    h.templates.set("t", { ...base, id: "t", name: "T", designFormat: "v2", designJson: v2Page("now"), draftJson: v2Page("draft") });
    await restoreTemplateVersion("t", { id: "rev1", designFormat: "v1", designJson: v1Design("OLD"), compiledHtml: "<p>old</p>" });
    let row = h.templates.get("t")!;
    expect(row.designFormat).toBe("v1");
    expect(row.designJson).toEqual(v1Design("OLD"));
    expect(row.draftJson).toBeUndefined();

    await restoreTemplateVersion("t", { id: "rev2", designFormat: "v2", designJson: v2Page("back"), compiledHtml: "<p>new</p>" });
    row = h.templates.get("t")!;
    expect(row.designFormat).toBe("v2");

    // an old revision row with no format at all restores as v1
    await restoreTemplateVersion("t", { id: "rev0", designJson: v1Design("ANCIENT"), compiledHtml: "" });
    expect(h.templates.get("t")!.designFormat).toBe("v1");
  });

  it("publishing writes the format on both the revision and the live row", async () => {
    await publishTemplateDraft({ id: "t", designFormat: "v2", designJson: {}, compiledHtml: "" }, { userId: "u", userName: "U" }, v2Page("p"), "<html>");
    expect(h.revisions[0].designFormat).toBe("v2");
    const tx = (h.sent[0] as { input: { TransactItems: { Update: { set: Record<string, unknown> } }[] } }).input.TransactItems;
    expect(tx[1].Update.set.designFormat).toBe("v2");
  });
});

describe("new-template creation honours TEMPLATES_V2_NEW", () => {
  const old = process.env.TEMPLATES_V2_NEW;
  afterEach(() => {
    if (old === undefined) delete process.env.TEMPLATES_V2_NEW;
    else process.env.TEMPLATES_V2_NEW = old;
  });

  async function create(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    vi.resetModules();
    vi.doMock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u", organizationId: "o", role: null, subscriptionPlan: "ULTRA" }) }));
    vi.doMock("@/server/requirePermissionDynamo", () => ({ requirePermission: () => null }));
    vi.doMock("@/server/templateNameDynamo", () => ({ isTemplateNameTaken: async () => false }));
    vi.doMock("@/server/slugDynamo", () => ({ ensureUniqueSlug: async (_p: string, s: string) => s }));
    vi.doMock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: { aupAcceptedAt: "x" } }) }), patch: () => ({ set: () => ({ go: async () => ({}) }) }) } }));
    vi.doMock("@/lib/siteLayoutDynamo", async () => await import("@/lib/siteLayoutCore"));
    vi.doMock("@/server/rawUpload", () => ({ validateRawHtmlContent: () => undefined, RawUploadValidationError: class extends Error {} }));
    vi.doMock("@/server/rawUploadLimit", () => ({ rawUploadLimitMessage: async () => null }));
    const { POST } = await import("@/app/api/templates/route");
    const req = new Request("http://x/api/templates", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const res = await POST(req as never);
    return { status: res.status, json: await res.json() };
  }

  it("flag off: a new landing page is classic v1, blank shell, nothing compiled", async () => {
    delete process.env.TEMPLATES_V2_NEW;
    const r = await create({ name: "Site A", kind: "LANDING_PAGE" });
    expect(r.status).toBe(201);
    const row = h.templates.get(r.json.template.id)!;
    expect(row.designFormat ?? "v1").toBe("v1");
    expect(row.designJson.body).toBeDefined();
  });

  it("flag on: a new landing page is a blank v2 page that already compiles; an email starts in v2 too", async () => {
    process.env.TEMPLATES_V2_NEW = "true";
    const r = await create({ name: "Site B", kind: "LANDING_PAGE" });
    const row = h.templates.get(r.json.template.id)!;
    expect(row.designFormat).toBe("v2");
    expect(row.designJson.format).toBe(V2_FORMAT);
    expect(row.compiledHtml).toMatch(/^<!doctype html>/);
    const e = await create({ name: "Mail", kind: "EMAIL" });
    expect(h.templates.get(e.json.template.id)!.designFormat).toBe("v2");
  });

  it("flag on: a page from an SDK page template; sub-pages follow their site's format", async () => {
    process.env.TEMPLATES_V2_NEW = "true";
    const root = await create({ name: "Site C", kind: "LANDING_PAGE", pageTemplate: "pricing" });
    const rootRow = h.templates.get(root.json.template.id)!;
    expect(rootRow.designJson.pages[0].rootNode.children.length).toBeGreaterThan(2);
    const kid = await create({ name: "About", kind: "LANDING_PAGE", parentId: rootRow.id });
    expect(h.templates.get(kid.json.template.id)!.designFormat).toBe("v2");

    delete process.env.TEMPLATES_V2_NEW;
    h.templates.set("classic", { ...base, id: "classic", name: "Old", designJson: v1Design("x") });
    const kid2 = await create({ name: "Kid", kind: "LANDING_PAGE", parentId: "classic" });
    expect(h.templates.get(kid2.json.template.id)!.designFormat ?? "v1").toBe("v1");
  });

  it("explicit designFormat: honoured from the dashboard session, ignored on an API-key call", async () => {
    delete process.env.TEMPLATES_V2_NEW;
    const dash = await create({ name: "Dash", kind: "LANDING_PAGE", designFormat: "v2" });
    expect(h.templates.get(dash.json.template.id)!.designFormat).toBe("v2");
    const api = await create({ name: "Api", kind: "LANDING_PAGE", designFormat: "v2" }, { authorization: "Bearer plx_key" });
    expect(h.templates.get(api.json.template.id)!.designFormat ?? "v1").toBe("v1");
    const mail = await create({ name: "Mail2", kind: "EMAIL", designFormat: "v2" });
    expect(mail.status).toBe(201);
  });
});

describe("public form submit finds the form in a v2 design", () => {
  it("restores labels, ignores a filled honeypot, redirects back to the page", async () => {
    h.templates.set("root", { ...base, id: "root", organizationId: "o", name: "Home", designFormat: "v2" });
    const form = { id: "frm", type: "form", name: "Contact", props: { fields: [{ id: "f1", label: "Your name", type: "text" }, { id: "f2", label: "Email", type: "email" }] }, styles: {} } as DocumentNode;
    h.templates.set("root", { ...h.templates.get("root"), designJson: v2Page("Home", { ...sec("s", "x"), children: [form] } as DocumentNode) });

    vi.resetModules();
    vi.doMock("@/lib/pub/resolveSiteDynamo", () => ({ resolveSite: async () => ({ status: "ok", published: { templateId: "root", organization: { id: "o" } } }) }));
    vi.doMock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true, clientIp: () => "1.1.1.1" }));
    vi.doMock("@/lib/forms/recordSubmission", () => ({
      collectFormFields: (entries: Iterable<[string, unknown]>) => Object.fromEntries([...entries].filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, (v as string).trim()])),
      recordFormSubmission: async (i: unknown) => void h.submissions.push(i),
    }));
    vi.doMock("@/lib/db/opsEntities", () => ({ FormSettings: { get: () => ({ go: async () => ({ data: null }) }) } }));
    const { POST } = await import("@/app/api/public/forms/[templateId]/submit/route");

    const send = (fields: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      // The ticket the page asked for when it loaded (lib/forms/humanCheck.ts), a few seconds old by the time the form is sent.
      fd.append("_plx_check", issueHumanCheck("root", Date.now() - 10_000));
      return POST(
        new Request("http://site.test/api/public/forms/root/submit?form=Contact&page=root&fid=frm", { method: "POST", headers: { host: "site.test", referer: "http://site.test/contact" }, body: fd }) as never,
        { params: Promise.resolve({ templateId: "root" }) },
      );
    };
    h.submissions.length = 0;
    const ok = await send({ f1: "Ada", f2: "ada@x.co", _hp_field: "" });
    expect(ok.status).toBe(303);
    expect(new URL(ok.headers.get("location")!).pathname).toBe("/contact");
    expect(h.submissions[0]).toMatchObject({ formName: "Contact", fields: { "Your name": "Ada", Email: "ada@x.co" } });

    h.submissions.length = 0;
    const bot = await send({ f1: "Bot", _hp_field: "gotcha" });
    expect(bot.status).toBe(303);
    expect(h.submissions).toHaveLength(0);
  });
});
