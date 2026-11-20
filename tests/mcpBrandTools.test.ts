import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

vi.mock("@/server/authDynamo", () => ({ auth: vi.fn(), dynamoAdapter: {} }));

import { PLEXO_MCP_TOOLS } from "@/lib/mcp/dispatchMcpTool";
import { APP_CODE_BRAND_NOTE, APP_CODE_TOOLS, BRAND_AWARE_TOOLS, BRAND_NOTE, MCP_SERVER_INSTRUCTIONS, withBrandNote } from "@/lib/mcp/brandNote";
import { BRAND_MCP_TOOLS } from "@/lib/mcp/brandTools";
import { applyBriefDefaults, mergeBrand } from "@/lib/brand/brandModel";
import { LINKED_AMA } from "./fixtures/strataBrandFixtures";

const byName = new Map((PLEXO_MCP_TOOLS as Array<{ name: string; description?: string; inputSchema?: { properties?: Record<string, unknown> } }>).map((t) => [t.name, t]));

describe("the MCP catalogue knows about the brand", () => {
  it("has the four brand tools, once each", () => {
    for (const name of ["get_site_brand", "list_strata_projects", "link_site_brand", "create_strata_project_from_brand"]) {
      expect(PLEXO_MCP_TOOLS.filter((t: { name: string }) => t.name === name)).toHaveLength(1);
    }
    expect(BRAND_MCP_TOOLS).toHaveLength(10); // + get_brand_voice, set_brand_voice
  });
  it("has the component and token tools, once each, and tells the AI to use the brand's components first", () => {
    for (const name of ["list_brand_components", "create_brand_component", "get_brand_tokens", "set_brand_tokens"]) {
      expect(PLEXO_MCP_TOOLS.filter((t: { name: string }) => t.name === name), name).toHaveLength(1);
    }
    expect(byName.get("create_brand_component")!.inputSchema).toMatchObject({ required: ["name", "styles"] });
    expect(byName.get("list_brand_components")!.description).toMatch(/USE THEM FIRST/);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/THE BRAND LIVES IN STRATA/);
    expect(MCP_SERVER_INSTRUCTIONS).toContain("list_brand_components");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("create_brand_component");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("set_brand_tokens");
    expect(BRAND_NOTE).toContain("list_brand_components");
  });
  it("every tool that makes or restyles something carries the brand sentence exactly once", () => {
    for (const name of BRAND_AWARE_TOOLS) {
      const tool = byName.get(name);
      expect(tool, `${name} must be a real tool`).toBeTruthy();
      const count = (tool!.description ?? "").split(BRAND_NOTE).length - 1;
      expect(count, name).toBe(1);
    }
  });
  it("the app-code tools carry the brand-variables and layout-link guidance exactly once; other tools don't", () => {
    for (const name of APP_CODE_TOOLS) {
      const d = byName.get(name)!.description ?? "";
      expect(d.split(APP_CODE_BRAND_NOTE).length - 1, name).toBe(1);
    }
    expect(byName.get("page_edit")!.description).not.toContain(APP_CODE_BRAND_NOTE);
    expect(MCP_SERVER_INSTRUCTIONS.split("/__plexo/brand/<siteId>.css").length - 1).toBe(1);
  });
  it("adding the sentence is idempotent and leaves other tools alone", () => {
    const once = withBrandNote({ name: "page_edit", description: "x" });
    expect(withBrandNote(once)).toEqual(once);
    expect(withBrandNote({ name: "list_blog_posts", description: "x" }).description).toBe("x");
  });
  it("site_create takes strataProjectId and says the saved brand is the default", () => {
    const t = byName.get("site_create")!;
    expect(t.inputSchema?.properties).toHaveProperty("strataProjectId");
    expect(t.description).toMatch(/saved brand/);
  });
  it("get_strata_tokens points at get_site_brand and takes a siteId", () => {
    const t = byName.get("get_strata_tokens")!;
    expect(t.description).toContain("get_site_brand");
    expect(t.inputSchema?.properties).toHaveProperty("siteId");
  });
  it("the server instructions tell the model to read the brand first, use it by default and not ask again", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain("get_site_brand");
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/Never ask for colours, fonts or a logo while a brand exists/);
    expect(MCP_SERVER_INSTRUCTIONS).toContain("list_strata_projects");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("create_strata_project_from_brand");
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/Linked Strata project, then the site's own saved brand, then the account's/i);
  });
  it("brand tool descriptions carry the precedence rule and the no-asking rule", () => {
    expect(byName.get("get_site_brand")!.description).toMatch(/never ask the owner for colours/i);
    expect(byName.get("get_site_brand")!.description).toMatch(/linked Strata project, then the site's own saved brand, then the account's/);
  });
});

describe("default injection for site_create", () => {
  const brand = mergeBrand({ linked: LINKED_AMA });
  it("a bare brief gets the brand; a brief with its own colours keeps them", () => {
    expect(applyBriefDefaults({ name: "x" } as { name: string; colors?: string[] }, brand).brief.colors?.[0]).toBe("#E4572E");
    expect(applyBriefDefaults({ colors: ["navy"] }, brand).brief.colors).toEqual(["navy"]);
  });
});
