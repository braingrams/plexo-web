import { beforeEach, describe, expect, it, vi } from "vitest";

// The Brand page's "apply to my pages" for a site with NO shared header (a site made from a marketplace design): the logo has to go
// into the header section of the page itself, or the owner's logo is saved but never shows.
const h = vi.hoisted(() => ({
  layout: null as any,
  rows: [] as any[],
  edits: [] as Array<{ id: string; commands: any[] }>,
}));

vi.mock("@charisol/plexo-sdk/v2/compile", () => ({ describeDesign: () => ({ pages: [{ sections: [] }] }) }));
vi.mock("@/lib/db/contentEntities", () => ({
  SiteLayout: { get: () => ({ go: async () => ({ data: h.layout }) }) },
  Template: { get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.rows.find((r) => r.id === id) ?? null }) }) },
}));
vi.mock("@/lib/siteLayoutCore", () => ({ findRootTemplateId: async () => "s1", onTemplateSaved: async () => undefined }));
vi.mock("@/lib/templateVersions", () => ({ publishTemplateDraft: async () => undefined }));
vi.mock("@/lib/mcp/v2Pages", () => ({
  loadSiteRows: async () => h.rows,
  formatLabel: (r: any) => (r.designFormat === "v2" ? "v2" : "classic"),
  currentDesign: async (r: any) => r.designJson,
  saveEdit: async (row: any, commands: any[]) => {
    h.edits.push({ id: row.id, commands });
    return { saved: true, results: commands.map(() => ({ ok: true })) };
  },
}));

import { applySiteLogo, applySiteLook } from "@/lib/sites/applyLook";

const section = (id: string, kind: string, content: Record<string, unknown>) => ({ id, type: "section", props: { block: { kind, content } } });
const page = (...sections: unknown[]) => ({ format: "plexo-v2@1", pages: [{ id: "p", name: "Home", rootNode: { id: "root", type: "page", children: sections } }] });
const input = { organizationId: "o1", userId: "u1", userName: "Ada", siteId: "s1", hadLogo: false };

beforeEach(() => {
  h.layout = null;
  h.edits = [];
  h.rows = [{ id: "s1", designFormat: "v2", designJson: page(section("hd", "header", { brand: "Aria" }), section("hero", "hero", {})) }];
});

describe("a site with no shared header", () => {
  it("puts the logo in the page's own header together with the colours", async () => {
    const out = await applySiteLook({ ...input, look: { colors: ["#2255EE"], logoUrl: "https://x/logo.png", logoSkipped: false } });
    expect(h.edits).toHaveLength(1);
    expect(h.edits[0].commands).toEqual([{ op: "setBrand", tokens: { primaryColor: "#2255EE" } }, { op: "updateSection", sectionId: "hd", content: { logo: "https://x/logo.png" } }]);
    expect(out).toMatchObject({ updated: 1, logoPlaced: true });
  });

  it("clears it when the owner removed their logo", async () => {
    await applySiteLook({ ...input, hadLogo: true, look: { colors: ["#2255EE"], logoUrl: null, logoSkipped: true } });
    expect(h.edits[0].commands[1]).toEqual({ op: "updateSection", sectionId: "hd", content: { logo: "" } });
  });

  it("only recolours a page that has no header, and never touches the logo when the brand has none", async () => {
    h.rows = [{ id: "s1", designFormat: "v2", designJson: page(section("hero", "hero", {})) }];
    const a = await applySiteLook({ ...input, look: { colors: ["#2255EE"], logoUrl: "https://x/logo.png", logoSkipped: false } });
    expect(h.edits[0].commands).toHaveLength(1);
    expect(a.logoPlaced).toBe(false);
    h.rows = [{ id: "s1", designFormat: "v2", designJson: page(section("hd", "header", { brand: "Aria", logo: "https://x/mine.png" })) }];
    h.edits = [];
    await applySiteLook({ ...input, look: { colors: ["#2255EE"], logoUrl: null, logoSkipped: true } });
    expect(h.edits[0].commands).toHaveLength(1);
  });

  it("a logo changed on the linked brand goes into each page's header", async () => {
    h.rows.push({ id: "s2", designFormat: "v2", designJson: page(section("h2", "header", {})) }, { id: "s3", designFormat: "v1", designJson: {} });
    const out = await applySiteLogo({ organizationId: "o1", siteId: "s1", logoUrl: "https://x/new.png" });
    expect(out).toEqual({ placed: true });
    expect(h.edits.map((e) => [e.id, e.commands[0].sectionId])).toEqual([["s1", "hd"], ["s2", "h2"]]);
  });

  it("reports no place when no page has a header", async () => {
    h.rows = [{ id: "s1", designFormat: "v2", designJson: page(section("hero", "hero", {})) }];
    expect(await applySiteLogo({ organizationId: "o1", siteId: "s1", logoUrl: "https://x/new.png" })).toEqual({ placed: false });
  });
});
