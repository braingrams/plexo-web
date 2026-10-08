import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});
vi.mock("@/lib/mcp/dispatchMcpTool", () => ({ dispatchMcpTool: vi.fn() }));

import { pairToolCalls } from "@/lib/ai/solAgent";

const ask = { type: "tool_use", id: "toolu_q", name: "ask_user_question", input: { questions: [] } };

describe("SOL history sent to the model", () => {
  it("a reply typed while SOL's question was open answers it (the production 400)", () => {
    // Exactly what production stored: the question, then "Yes html" typed in the chat box.
    const out = pairToolCalls([
      { role: "user", content: [{ type: "text", text: "Build a hero page" }] },
      { role: "assistant", content: [{ type: "text", text: "HTML or builder?" }, ask] },
      { role: "user", content: [{ type: "text", text: "Yes html" }] },
    ]);
    expect(out[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_q", is_error: false });
    expect(out[2].content[1]).toEqual({ type: "text", text: "Yes html" });
  });

  it("an action that was never confirmed counts as not done", () => {
    const del = { type: "tool_use", id: "toolu_d", name: "delete_template", input: {} };
    const out = pairToolCalls([
      { role: "user", content: [{ type: "text", text: "delete it" }] },
      { role: "assistant", content: [del] },
      { role: "user", content: [{ type: "text", text: "actually, wait" }] },
    ]);
    expect(out[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_d", is_error: true });
    expect(out[2].content[0].content).toMatch(/Not done/);
  });

  it("results orphaned by the 40-message window are dropped, and it starts with the user", () => {
    const out = pairToolCalls([
      { role: "user", content: [{ type: "tool_result", tool_use_id: "gone", content: "x" }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
      { role: "user", content: [{ type: "text", text: "thanks" }] },
    ]);
    expect(out).toEqual([{ role: "user", content: [{ type: "text", text: "thanks" }] }]);
  });

  it("leaves a healthy history and a still-open pause alone", () => {
    const healthy = [
      { role: "user" as const, content: [{ type: "text", text: "hi" }] },
      { role: "assistant" as const, content: [ask] },
      { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "toolu_q", content: "Q: a\nA: b" }] },
      { role: "assistant" as const, content: [{ type: "text", text: "ok" }, { ...ask, id: "toolu_open" }] },
    ];
    expect(pairToolCalls(healthy)).toEqual(healthy);
  });
});
