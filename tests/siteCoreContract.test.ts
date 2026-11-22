import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/contentEntities", () => ({ Template: {}, BlogSite: {}, SiteLayout: {}, PublishedDomain: {}, PublishedDomainEntity: {} }));
vi.mock("@/lib/db/commerceEntities", () => ({ CommerceSettings: {} }));
vi.mock("@/lib/mcp/v2Pages", () => ({ PageToolError: class extends Error {}, MAX_COMMANDS: 50, editableUrlFor: () => "", formatLabel: () => "v2", loadOwnedRow: async () => ({}), saveEdit: async () => ({}) }));
vi.mock("@/lib/siteLayoutProvision", () => ({ ensureSiteLayout: async () => null }));
vi.mock("@/lib/customCode/store", () => ({ readCustomCode: async () => ({}), saveCustomCode: async () => ({ ok: false, error: "x", status: 403 }) }));
vi.mock("@/lib/v2/designSystemStore", () => ({ resolveDesignSystem: async (x: unknown) => x }));
vi.mock("@/lib/commerce/storefrontLayout", () => ({ getStorefrontPath: async () => null }));

import { SITE_CORE_MCP_TOOLS, SITE_CORE_TOOL_NAMES } from "@/lib/mcp/siteCoreTools";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tool = (name: string) => SITE_CORE_MCP_TOOLS.find((t) => t.name === name)!;

describe("MCP site-core tool contract", () => {
  it("offers the five tools, each with a plain description and a required siteId/templateId", () => {
    expect([...SITE_CORE_TOOL_NAMES].sort()).toEqual(["page_chrome_set", "site_code_get", "site_code_set", "site_layout_describe", "site_layout_edit"]);
    for (const t of SITE_CORE_MCP_TOOLS) {
      expect(t.description.length).toBeGreaterThan(80);
      expect(t.inputSchema.required.some((r: string) => r === "siteId" || r === "templateId")).toBe(true);
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
    }
  });
  it("header/footer code is described as Starter and above, never Pro-only", () => {
    for (const n of ["site_code_get", "site_code_set"]) {
      expect(tool(n).description).not.toMatch(/Pro plan and above|Pro plan\b/);
    }
    expect(tool("site_code_set").description).toMatch(/Starter/);
    expect(tool("site_code_set").description).toMatch(/cart\/checkout/);
    expect(tool("site_code_set").inputSchema.properties).toHaveProperty("onCheckout");
  });
  it("tells the assistant older sites start blank and how to adopt a header without duplicates", () => {
    const d = tool("site_layout_describe").description + tool("site_layout_edit").description;
    expect(d).toMatch(/BLANK/);
    expect(d).toMatch(/removeOldChrome/);
    expect(d).toMatch(/Hand-written/i);
    expect(tool("site_layout_edit").inputSchema.properties).toHaveProperty("removeOldChrome");
  });
});

describe("new sites and pages use site-core by default (regression guards)", () => {
  const pages = read("lib/mcp/v2Pages.ts");
  it("MCP/SOL site creation provisions the shared header and footer, or a blank pair for ready-made designs", () => {
    expect(pages).toMatch(/ensureSiteLayout\(id, resolved\.organizationId, resolved\.userId\)/);
    expect(pages).toMatch(/ensureBlankSiteLayout\(id, resolved\.userId\)/);
  });
  it("a new home page starts without its own header and footer (chrome: false) so nothing is doubled", () => {
    expect(pages).toMatch(/\.\.\.\(parent \? \{\} : \{ chrome: false \}\)/);
  });
  it("pages added to a site that shares a header drop their own (fitPageToSite) and generators ask chromeFor", () => {
    expect(pages).toMatch(/fitPageToSite\(/);
    expect(pages).toMatch(/chromeFor\(rootId/);
    for (const f of ["lib/commerce/storefrontLayout.ts", "lib/commerce/productDetailLayout.ts", "lib/mcp/blogTools.ts"]) expect(read(f)).toMatch(/chromeFor\(/);
  });
  it("the dashboard's new-site route gives every kind of builder site its header and footer", () => {
    const route = read("app/api/templates/route.ts");
    expect(route).toMatch(/ensureSiteLayout\(id/);
    expect(route).toMatch(/ensureBlankSiteLayout\(id/);
  });
  it("SOL is told about blank headers, code limits and the checkout rule", () => {
    const sol = read("lib/ai/solAgent.ts");
    expect(sol).toMatch(/BLANK shared header\/footer/);
    expect(sol).toMatch(/Starter plan or above/);
    expect(sol).toMatch(/onCheckout/);
  });
  it("the public site applies owner code on all three serving paths, telling it the frame type", () => {
    const route = read("app/pub/[domain]/[[...slug]]/route.ts");
    expect(route.match(/applyOwnerCode\(html, \{[^}]*secFetchDest/g)?.length).toBe(3);
  });
});
