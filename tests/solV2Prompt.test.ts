import { describe, expect, it, vi } from "vitest";
import { SOL_SYSTEM_PROMPT } from "@charisol/plexo-sdk/v2/compile";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});
vi.mock("@/lib/mcp/dispatchMcpTool", () => ({ dispatchMcpTool: vi.fn(), PLEXO_MCP_TOOLS: [] }));
vi.mock("@/lib/ai/solAttachments", () => ({ createAttachmentResolver: () => async (h: unknown) => h, publishAttachedImage: vi.fn(), PRIVATE_ATTACHMENT_PATH: "private/sol-attachments/" }));
vi.mock("@/lib/ai/providers/bedrockClaude", () => ({ generateWithTools: vi.fn() }));

import { buildSolSystemPrompt } from "@/lib/ai/solAgent";
import { buildConversationDocument } from "@/lib/sol/exportDocument";

// SOL's instructions for visual pages: V2 is the only way, with the SDK's own command guide.
describe("SOL's system prompt teaches the V2 workflow", () => {
  const prompt = buildSolSystemPrompt([]);

  it("names the V2 tools and the describe -> edit -> publish order", () => {
    for (const tool of ["page_create_from_template", "page_describe", "page_edit", "page_publish", "blog_layout_edit"]) expect(prompt).toContain(tool);
    expect(prompt.indexOf("page_describe first")).toBeGreaterThan(-1);
    expect(prompt).toMatch(/ONE way/);
  });

  it("includes the SDK's section-command guide exactly once", () => {
    expect(prompt).toContain(SOL_SYSTEM_PROMPT);
    expect(prompt.split(SOL_SYSTEM_PROMPT).length - 1).toBe(1);
  });

  it("no longer offers the raw-HTML-vs-builder choice or recommends raw HTML", () => {
    expect(prompt).not.toMatch(/two genuinely different ways/);
    expect(prompt).not.toMatch(/\(Recommended\)/);
    expect(prompt).not.toMatch(/drag-and-drop BUILDER page \(create_landing_page/);
    expect(prompt).toMatch(/never offer the owner a choice between builders/);
    expect(prompt).toMatch(/deprecated/);
  });

  it("keeps email on the classic tools and the app-building section intact", () => {
    expect(prompt).toMatch(/Email templates are separate and still use create_email_template/);
    expect(prompt).toContain("## Building apps");
    expect(prompt).toContain("app_design_edit");
  });
});

describe("SOL export labels the page tools in plain words", () => {
  it("reads 'edited the page', not a raw tool name", () => {
    const doc = buildConversationDocument({ title: "t" }, [
      { role: "assistant", content: [{ type: "tool_use", id: "a", name: "page_edit", input: { name: "Home" } }] },
      { role: "tool", content: [{ type: "tool_result", tool_use_id: "a", content: JSON.stringify({ ok: true }) }] },
    ] as never);
    expect(doc.blocks).toContainEqual({ kind: "toolAction", label: 'Sol edited the page "Home".', status: "success" });
  });
});
