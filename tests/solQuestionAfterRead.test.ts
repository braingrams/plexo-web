import { describe, expect, it } from "vitest";
import { pausingCall } from "@/app/dashboard/sol/_components/pausingCall";
import type { ContentBlock } from "@/app/dashboard/sol/_components/types";

// Staging, "telly" (second try): SOL read the app's files, then asked what customers pay for.
// The chat took the turn's FIRST call (the file read) as the one waiting, so no question box.

const read = { type: "tool_use", id: "r1", name: "app_read_files", input: { paths: ["src/App.tsx"] }, status: "success" };
const ask = { type: "tool_use", id: "q1", name: "ask_user_question", input: { questions: [{ question: "What are customers paying for?", options: [] }] } };

describe("which call a paused turn is waiting on", () => {
  it("live: the one marked awaiting, even after other steps", () => {
    const blocks = [{ type: "text", text: "Got it" }, read, { ...ask, status: "awaiting_confirmation" }] as ContentBlock[];
    expect(pausingCall(blocks)?.name).toBe("ask_user_question");
  });

  it("from history: the turn's last call", () => {
    const blocks = [{ type: "thinking" }, read, { type: "text", text: "Got it" }, ask] as ContentBlock[];
    expect(pausingCall(blocks)?.name).toBe("ask_user_question");
  });

  it("nothing to show when there's no call", () => {
    expect(pausingCall([{ type: "text", text: "hi" }] as ContentBlock[])).toBeUndefined();
    expect(pausingCall(undefined)).toBeUndefined();
  });
});
