import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  templates: new Map<string, Record<string, any>>(),
  revisions: [] as Record<string, any>[],
  user: { userId: "u1", organizationId: "o1", role: null as string | null, subscriptionPlan: "ULTRA" } as null | Record<string, any>,
}));

vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => h.user }));
vi.mock("@/server/requirePermissionDynamo", () => ({ requirePermission: () => null }));
vi.mock("@/server/requireTemplateScope", () => ({ requireTemplateScope: () => null }));
vi.mock("@/lib/db/coreEntities", () => ({ Member: { get: () => ({ go: async () => ({ data: null }) }) } }));
vi.mock("@/server/slugDynamo", () => ({ isValidUuid: () => true }));
vi.mock("@/lib/siteLayoutDynamo", async () => {
  const { compileTemplate } = await import("@/lib/compileTemplate");
  return {
    compileTemplateWithSiteLayout: async (t: any, designJson: unknown) => compileTemplate({ ...t, designJson }),
    onTemplateSaved: async () => {},
  };
});
vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.templates.get(id) ?? null }) }),
    patch: ({ id }: { id: string }) => {
      const set: Record<string, any> = {};
      const removed: string[] = [];
      const b: any = {
        set(v: Record<string, any>) { Object.assign(set, v); return b; },
        remove(keys: string[]) { removed.push(...keys); return b; },
        go: async () => {
          const row = h.templates.get(id)!;
          Object.assign(row, set, { updatedAt: "now" });
          for (const k of removed) delete row[k];
          return { data: row };
        },
      };
      return b;
    },
  },
  TemplateRevision: {
    create: (row: Record<string, any>) => ({ go: async () => { h.revisions.push(row); return { data: row }; } }),
    query: { primary: () => ({ go: async () => ({ data: [...h.revisions].reverse() }) }) },
  },
}));

import { POST as convert } from "@/app/api/templates/[id]/convert-to-v2/route";
import { POST as revert } from "@/app/api/templates/[id]/revert-to-classic/route";
import { isV2Design } from "@/lib/v2/design";

const v1 = (text: string) => ({
  body: { style: { background: "#fff", htmlTitle: "Tab" }, rows: [{ id: `r-${text}`, style: {}, columns: [{ id: `c-${text}`, width: "100%", elements: [{ id: `e-${text}`, type: "heading", style: {}, attributes: { text } }] }] }] },
});
const row = (over: Record<string, any> = {}) => ({ id: "t1", organizationId: "o1", userId: "u1", name: "Home", kind: "LANDING_PAGE", sourceType: "BUILDER", designJson: v1("LIVE"), compiledHtml: "<html>OLD LIVE</html>", ...over });
const call = (fn: typeof convert, id = "t1") => fn(new Request("http://x", { method: "POST" }) as any, { params: Promise.resolve({ id }) });

beforeEach(() => {
  h.templates.clear();
  h.revisions.length = 0;
  h.user = { userId: "u1", organizationId: "o1", role: null, subscriptionPlan: "ULTRA" };
});

describe("POST /api/templates/:id/convert-to-v2", () => {
  it("snapshots the classic page, flips it to the new editor, and leaves the live site alone", async () => {
    h.templates.set("t1", row({ draftJson: v1("DRAFT"), draftHtml: "<html>DRAFT</html>" }));
    const res = await call(convert);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.designFormat).toBe("v2");
    expect(body.hasUnpublishedChanges).toBe(true);
    expect(["exact", "approximate", "partial"]).toContain(body.fidelity);

    expect(h.revisions).toHaveLength(1);
    expect(h.revisions[0]).toMatchObject({ templateId: "t1", designFormat: "v1", designJson: v1("LIVE"), compiledHtml: "<html>OLD LIVE</html>", draftJson: v1("DRAFT") });

    const saved = h.templates.get("t1")!;
    expect(saved.designFormat).toBe("v2");
    expect(saved.classicBackupId).toBe(h.revisions[0].id);
    expect(isV2Design(saved.designJson)).toBe(true);
    expect(isV2Design(saved.draftJson)).toBe(true);
    expect(JSON.stringify(saved.draftJson)).toContain("DRAFT");
    // recompiled through the dispatcher as a complete V2 document; the live html isn't touched
    expect(saved.draftHtml).toContain("<html");
    expect(saved.draftHtml).toContain("DRAFT");
    expect(saved.compiledHtml).toBe("<html>OLD LIVE</html>");
  });

  it("a page with no unpublished changes gets no draft", async () => {
    h.templates.set("t1", row());
    expect((await call(convert)).status).toBe(200);
    expect(h.templates.get("t1")!.draftJson).toBeUndefined();
    expect(h.revisions[0].draftJson).toBeUndefined();
  });

  it("refuses emails, uploaded pages, shared layouts and pages already moved, in plain words", async () => {
    for (const [over, status] of [
      [{ kind: "EMAIL" }, 400],
      [{ sourceType: "RAW_UPLOAD" }, 400],
      [{ isSiteLayoutFragment: true }, 400],
      [{ designFormat: "v2" }, 409],
    ] as const) {
      h.templates.set("t1", row(over));
      h.revisions.length = 0;
      const res = await call(convert);
      expect(res.status).toBe(status);
      expect((await res.json()).error).toMatch(/\w+ \w+ \w+/);
      expect(h.revisions).toHaveLength(0);
    }
  });

  it("is only for the signed-in owner's own organisation", async () => {
    h.templates.set("t1", row({ organizationId: "someone-else" }));
    expect((await call(convert)).status).toBe(404);
    h.user = null;
    expect((await call(convert)).status).toBe(401);
    expect(h.templates.get("t1")!.designFormat).toBeUndefined();
  });
});

describe("POST /api/templates/:id/revert-to-classic", () => {
  it("puts the classic page back exactly as it was, working copy included", async () => {
    h.templates.set("t1", row({ draftJson: v1("DRAFT"), draftHtml: "<html>DRAFT</html>" }));
    await call(convert);
    // changes made in the new editor since
    h.templates.get("t1")!.draftJson = { ...(h.templates.get("t1")!.draftJson as object), customJs: "x" };
    const res = await call(revert);
    expect(res.status).toBe(200);
    const t = h.templates.get("t1")!;
    expect(t.designFormat).toBe("v1");
    expect(t.designJson).toEqual(v1("LIVE"));
    expect(t.compiledHtml).toBe("<html>OLD LIVE</html>");
    expect(t.draftJson).toEqual(v1("DRAFT"));
    expect(t.draftHtml).toBe("<html>DRAFT</html>");
    expect(t.classicBackupId).toBeUndefined();
  });

  it("a page with no draft comes back without one", async () => {
    h.templates.set("t1", row());
    await call(convert);
    await call(revert);
    expect(h.templates.get("t1")!.draftJson).toBeUndefined();
    expect(h.templates.get("t1")!.designFormat).toBe("v1");
  });

  it("says so plainly when there is nothing to go back to", async () => {
    h.templates.set("t1", row({ designFormat: "v2", designJson: { format: "plexo-v2@1", pages: [] } }));
    const res = await call(revert);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no classic version/i);
    h.templates.set("t1", row({ designFormat: "v2", classicBackupId: "gone", designJson: {} }));
    expect((await call(revert)).status).toBe(404);
  });
});
