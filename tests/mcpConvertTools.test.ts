import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});
vi.mock("@/server/authDynamo", () => ({ auth: vi.fn(), dynamoAdapter: {} }));
// Not installed in every checkout; nothing here uses it.
vi.mock("@aws-sdk/client-iam", () => ({}));

const page: Record<string, unknown> = { id: "p1", organizationId: "o1", sourceType: "BUILDER", kind: "LANDING_PAGE" };
vi.mock("@/lib/db/contentEntities", () => ({ Template: { get: () => ({ go: async () => ({ data: page }) }) } }));
const preview = vi.fn();
const convert = vi.fn();
const restore = vi.fn();
vi.mock("@/lib/editorModes/convertService", () => ({ previewConvert: (...a: unknown[]) => preview(...a), convertToCode: (...a: unknown[]) => convert(...a), restoreBlocks: (...a: unknown[]) => restore(...a) }));

import { CONVERT_MCP_TOOLS, handleConvertTool } from "@/lib/mcp/convertTools";
import { PLEXO_MCP_TOOLS } from "@/lib/mcp/dispatchMcpTool";
import { isDestructiveTool } from "@/lib/mcp/toolRiskClassification";

const user = { organizationId: "o1", userId: "u1" } as never;
const notes = { copied: ["Your words"], heads: ["The header and footer are copied into this page."] };

describe("convert tools", () => {
  it("are registered once and restore is confirmed first", () => {
    for (const t of CONVERT_MCP_TOOLS) expect(PLEXO_MCP_TOOLS.filter((x: { name: string }) => x.name === t.name)).toHaveLength(1);
    expect(isDestructiveTool("restore_page_blocks")).toBe(true);
  });
  it("preview explains what comes along and changes nothing", async () => {
    preview.mockResolvedValue({ ok: true, value: { html: "<p>x</p>", hasUnpublishedChanges: false, isLive: true, notes } });
    const r = await handleConvertTool("convert_page_to_code", { templateId: "p1", preview: true }, user);
    expect(r.copied).toEqual(notes.copied);
    expect(r.next).toMatch(/header and footer/);
    expect(convert).not.toHaveBeenCalled();
  });
  it("refuses with the dashboard's reason", async () => {
    preview.mockResolvedValue({ ok: false, status: 400, error: "This page is already code." });
    await expect(handleConvertTool("convert_page_to_code", { templateId: "p1" }, user)).rejects.toThrow("already code");
  });
  it("makes the owner choose a version when there are unpublished changes on a live page", async () => {
    preview.mockResolvedValue({ ok: true, value: { html: "x", hasUnpublishedChanges: true, isLive: true, notes } });
    await expect(handleConvertTool("convert_page_to_code", { templateId: "p1" }, user)).rejects.toThrow(/which version/);
    convert.mockResolvedValue({ ok: true, value: { usedWorkingCopy: false, notes } });
    const r = await handleConvertTool("convert_page_to_code", { templateId: "p1", source: "live" }, user);
    expect(r.converted).toBe(true);
    expect(r.next).toMatch(/restore_page_blocks/);
  });
  it("won't touch another account's page", async () => {
    page.organizationId = "other";
    await expect(handleConvertTool("restore_page_blocks", { templateId: "p1" }, user)).rejects.toThrow(/No page found/);
    page.organizationId = "o1";
  });
  it("restore gives a plain result", async () => {
    restore.mockResolvedValue({ ok: true, value: null });
    expect((await handleConvertTool("restore_page_blocks", { templateId: "p1" }, user)).restored).toBe(true);
  });
});
