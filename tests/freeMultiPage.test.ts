import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Phase 4: the V2 page tools (page_describe / page_edit / page_create_from_template /
// page_publish / blog_layout_*), the deprecation of the classic and raw-HTML tools, and the
// flag-on delegation of the old create/publish tools to V2. In-memory stand-ins for the entities.

const h = vi.hoisted(() => ({
  templates: new Map<string, Record<string, any>>(),
  revisions: [] as Record<string, any>[],
  blogSites: new Map<string, Record<string, any>>(),
  domains: [] as Record<string, any>[],
  linked: [] as any[],
  products: new Map<string, Record<string, any>>(),
  commerceSettings: { enabled: true } as Record<string, any> | null,
}));

vi.mock("@/server/authDynamo", () => ({ auth: vi.fn(), dynamoAdapter: {} }));
vi.mock("@/lib/db/client", () => ({
  TABLES: { content: "content", commerce: "commerce", ops: "ops", import: "import" },
  // publishTemplateDraft sends one transaction (revision + template patch): apply the patch.
  docClient: {
    send: vi.fn(async (cmd: any) => {
      for (const item of cmd?.input?.TransactItems ?? []) {
        const u = item.Update;
        const row = u && h.templates.get(u.id);
        if (row) { Object.assign(row, u.set); for (const k of u.removed) delete row[k]; }
      }
      return {};
    }),
  },
}));
vi.mock("@aws-sdk/lib-dynamodb", async (orig) => ({ ...(await orig<object>()), TransactWriteCommand: class { constructor(public input: unknown) {} } }));

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
vi.mock("@/lib/db/contentEntities", async (orig) => ({
  ...(await orig<object>()),
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.templates.get(id) ?? null }) }),
    patch: ({ id }: { id: string }) => patchable(id),
    create: (row: Record<string, any>) => ({ go: async () => { h.templates.set(row.id, { designFormat: "v1", sourceType: "BUILDER", ...row }); return { data: row }; } }),
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
  SiteLayout: { get: () => ({ go: async () => ({ data: null }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
  BlogSite: {
    get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.blogSites.get(templateId) ?? null }) }),
    create: (row: Record<string, any>) => ({ go: async () => { h.blogSites.set(row.templateId, row); return { data: row }; } }),
    patch: ({ templateId }: { templateId: string }) => ({ set: (v: any) => ({ go: async () => { Object.assign(h.blogSites.get(templateId) ?? {}, v); return {}; } }) }),
    scan: { where: () => ({ go: async () => ({ data: [] }) }) },
  },
  PublishedDomain: { query: { primary: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.domains.filter((d) => d.templateId === templateId) }) }) } },
}));
vi.mock("@/lib/db/commerceEntities", async (orig) => ({
  ...(await orig<object>()),
  CommerceSettings: { get: () => ({ go: async () => ({ data: h.commerceSettings }) }), scan: { where: () => ({ go: async () => ({ data: [] }) }) } },
  CommerceProduct: { get: ({ templateId, id }: { templateId: string; id: string }) => ({ go: async () => ({ data: h.products.get(`${templateId}/${id}`) ?? null }) }) },
}));
vi.mock("@/lib/db/coreEntities", async (orig) => ({
  ...(await orig<object>()),
  User: { get: () => ({ go: async () => ({ data: { id: "u1", name: "Owner", aupAcceptedAt: "2026-01-01" } }) }), patch: () => ({ set: () => ({ go: async () => ({}) }) }) },
}));
vi.mock("@/lib/sites/linkDomain", async (orig) => ({
  ...(await orig<object>()),
  linkDomainToTemplate: vi.fn(async (_r: unknown, templateId: string, domain: string) => {
    h.linked.push({ templateId, domain });
    const finalDomain = domain.includes(".") ? domain : `${domain}.pages.test`;
    h.domains.push({ templateId, domain: finalDomain });
    return { finalDomain, publishedUrl: `https://${finalDomain}`, routingEndpoint: undefined, certificateValidationName: undefined, certificateValidationValue: undefined };
  }),
}));
vi.mock("@/lib/plan/sitesStore", async (orig) => ({ ...(await orig<object>()), setPagePublishFlags: vi.fn(async () => {}) }));

import { dispatchMcpTool } from "@/lib/mcp/dispatchMcpTool";

const ULTRA = { userId: "u1", organizationId: "o1", subscriptionPlan: "ULTRA", customDomainLimit: null, role: null } as any;
const FREE = { ...ULTRA, subscriptionPlan: "FREE" } as any;
const call = (tool: string, args: any, who = FREE) => dispatchMcpTool(tool, args, who);

beforeEach(() => {
  h.templates.clear();
  h.revisions.length = 0;
  h.domains.length = 0;
});

// Free builds and previews as many pages as it likes; only the home page goes live.
describe("a Free account building a multi-page site", () => {
  it("can add pages to its site", async () => {
    const home = await call("page_create_from_template", { name: "Course", templateId: "landing" });
    const about = await call("page_create_from_template", { name: "About", templateId: "about", siteId: home.siteId });
    expect(about).toMatchObject({ success: true, designFormat: "v2" });
    expect(h.templates.get(about.templateId)).toMatchObject({ parentId: home.siteId });
    const pages = await call("page_describe", { siteId: home.siteId, includeCatalog: false });
    expect(JSON.stringify(pages)).toContain("About");
  });

  it("can edit an extra page", async () => {
    const home = await call("page_create_from_template", { name: "Course", templateId: "landing" });
    const about = await call("page_create_from_template", { name: "About", templateId: "about", siteId: home.siteId });
    const edit = await call("page_edit", { templateId: about.templateId, commands: [{ op: "renamePage", name: "Our story" }] });
    expect(edit.ok).toBe(true);
  });

  it("can't put an extra page live, and is told why in plain words", async () => {
    const home = await call("page_create_from_template", { name: "Course", templateId: "landing" });
    const about = await call("page_create_from_template", { name: "About", templateId: "about", siteId: home.siteId });
    await expect(call("page_publish", { templateId: about.templateId })).rejects.toThrow(/Free plan publishes one page per site.*saved/);
    expect(h.templates.get(about.templateId)).toBeDefined();
  });

  it("can still publish its home page", async () => {
    const home = await call("page_create_from_template", { name: "Course", templateId: "landing" });
    const live = await call("page_publish", { templateId: home.templateId, domain: "course" });
    expect(live.success).toBe(true);
  });
});
