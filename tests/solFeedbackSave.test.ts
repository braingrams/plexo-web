import { describe, expect, it, vi } from "vitest";

const rows: unknown[] = [];
const patch = vi.fn();
const put = vi.fn();
vi.mock("@/lib/db/solEntities", () => ({
  SolMessage: { query: { primary: () => ({ go: async () => ({ data: rows }) }) }, patch: (k: unknown) => ({ set: (v: unknown) => ({ go: () => patch(k, v) }) }) },
}));
vi.mock("@/lib/db/opsEntities", () => ({ SolFeedback: { put: (v: unknown) => ({ go: () => put(v) }) } }));
vi.mock("@/lib/solAnalytics", () => ({ recordSolFeedback: vi.fn().mockResolvedValue(undefined) }));

import { saveSolFeedback } from "@/lib/sol/feedback";

const m = (id: string, role: string, createdAt: string, content: unknown, userId = "u1") => ({ id, role, createdAt, content, userId });

describe("saving a rating keeps the whole exchange for plexo-admin", () => {
  it("stores the question, every spoken part of the answer, the tools and the note", async () => {
    rows.length = 0;
    rows.push(
      m("u0", "user", "2026-11-23T09:00:00Z", [{ type: "text", text: "older question" }]),
      m("a0", "assistant", "2026-11-23T09:01:00Z", [{ type: "text", text: "older answer" }]),
      m("u1", "user", "2026-11-23T10:00:00Z", [{ type: "text", text: "Which of my sites is performing best" }]),
      m("a1", "assistant", "2026-11-23T10:01:00Z", [{ type: "text", text: "Let me check." }, { type: "tool_use", name: "get_analytics", id: "x", input: {} }]),
      m("a2", "assistant", "2026-11-23T10:02:00Z", [{ type: "text", text: "EmpowerHealth is top." }]),
    );
    const res = await saveSolFeedback({ userId: "u1", conversationId: "c1", rating: "DOWN", comment: " it should ask first ", source: "dashboard" });
    expect(res?.id).toBe("a2");
    expect(patch).toHaveBeenCalledWith({ conversationId: "c1", createdAt: "2026-11-23T10:02:00Z", id: "a2" }, { feedback: "DOWN", feedbackComment: "it should ask first" });
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ id: "a2", rating: "DOWN", comment: "it should ask first", question: "Which of my sites is performing best", answer: "Let me check.\n\nEmpowerHealth is top.", tools: "get_analytics", source: "dashboard" }));
  });

  it("returns null for someone else's conversation", async () => {
    rows.length = 0;
    rows.push(m("a1", "assistant", "2026-11-23T10:01:00Z", [{ type: "text", text: "hi" }], "someone-else"));
    expect(await saveSolFeedback({ userId: "u1", conversationId: "c1", rating: "UP", source: "whatsapp" })).toBeNull();
  });
});
