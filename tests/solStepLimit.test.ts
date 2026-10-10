import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Staging, watchy: SOL built the app over 40 rounds, then the turn ended in a red
// "couldn't finish this action within 8 tool-call rounds" (wrong number, and an error for a
// turn whose work was all saved). Now its last step is a plain summary instead.

const saved = vi.hoisted(() => [] as any[]);
const calls = vi.hoisted(() => ({ model: 0, lastHistory: [] as any[] }));

vi.mock("@/lib/db/solEntities", () => ({
  SolMessage: {
    query: { primary: () => ({ go: async () => ({ data: [] }) }) },
    create: (row: any) => ({ go: async () => (saved.push(row), { data: { ...row, createdAt: new Date().toISOString() } }) }),
    patch: () => ({ set: () => ({ go: async () => ({}) }) }),
  },
}));
vi.mock("@/lib/mcp/dispatchMcpTool", () => ({ dispatchMcpTool: vi.fn(async () => ({ ok: true })), PLEXO_MCP_TOOLS: [{ name: "app_status", description: "x", inputSchema: { type: "object", properties: {} } }] }));
vi.mock("@/lib/ai/solAttachments", () => ({
  createAttachmentResolver: () => async (h: unknown) => h,
  publishAttachedImage: vi.fn(),
  PRIVATE_ATTACHMENT_PATH: "private/sol-attachments/",
}));
vi.mock("@/lib/ai/providers/bedrockClaude", () => ({
  generateWithTools: vi.fn(async (p: { conversationHistory: any[] }) => {
    calls.model += 1;
    calls.lastHistory = p.conversationHistory;
    const last = p.conversationHistory[p.conversationHistory.length - 1];
    const asked = JSON.stringify(last.content).includes("step limit");
    if (asked) return { content: [{ type: "text", text: "Watchy's shop, sign-in and reviews are built. Left: the checkout email. Say “continue” and I'll finish it." }], stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 20 } };
    return { content: [{ type: "tool_use", id: `t${calls.model}`, name: "app_status", input: { appId: "a1" } }], stopReason: "tool_use", usage: { inputTokens: 10, outputTokens: 5 } };
  }),
}));

import { runAgentTurn } from "@/lib/ai/solAgent";
import { MAX_APP_TOOL_ITERATIONS } from "@/lib/credits/agentTurnEstimate";

describe("a long app-building turn", () => {
  it("ends with a plain summary when it uses all its steps, not an error", async () => {
    const out = await runAgentTurn({
      conversationId: "c1",
      resolvedUser: { userId: "u1", organizationId: "o1" } as never,
      modelTier: "MEDIUM",
      provider: "bedrock_claude",
      userMessageContent: [{ type: "text", text: "Build watchy" }],
      memoryFacts: [],
      appContext: "App: watchy",
      onTextDelta: () => {},
      onToolCallStart: () => {},
      onToolCallAwaitingConfirmation: async () => {},
      onToolCallResult: () => {},
      budgetGuard: async () => true,
    } as never);
    expect(calls.model).toBe(MAX_APP_TOOL_ITERATIONS + 1);
    expect((out as { finalText: string }).finalText).toMatch(/Say “continue”/);
    // Saved as an ordinary answer, and every tool call in the history it was given was answered.
    expect(saved.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text" }] });
    const lastUser = calls.lastHistory.at(-1);
    expect(lastUser.role).toBe("user");
    expect(lastUser.content.some((b: any) => b.type === "tool_result")).toBe(true);
  });
});
