// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { useSolStream } from "@/app/dashboard/sol/_components/useSolStream";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// SOL's question arrives after a "preparing" placeholder for the same call. The placeholder
// has no input yet; the finished question must replace it, or the question box has nothing
// to show and the chat sits there looking frozen (seen on staging: "telly" first build).

const question = { questions: [{ question: "What are customers paying for?", options: [{ label: "A catalog of products" }, { label: "A single plan" }] }] };
const frames = [
  { type: "token", text: "Got it — two quick things:" },
  { type: "tool_call_preparing", id: "t1", name: "ask_user_question", label: "Asking", characters: 120 },
  { type: "tool_call_awaiting_confirmation", id: "t1", name: "ask_user_question", args: question, messageId: "m1" },
];
vi.stubGlobal("fetch", vi.fn(async () => new Response(frames.map((f) => JSON.stringify(f)).join("\n") + "\n", { status: 200 })));

describe("SOL asking a question", () => {
  it("shows the question even when a preparing placeholder came first", async () => {
    let stream!: ReturnType<typeof useSolStream>;
    function Harness() {
      stream = useSolStream();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Harness />));
    await act(async () => {
      await stream.sendMessage("c1", "Build telly", [], "MEDIUM");
    });

    expect(stream.outcome).toBe("awaiting_confirmation");
    expect(stream.awaitingMessageId).toBe("m1");
    const block = stream.blocks.find((b) => b.type === "tool_use") as { input: unknown; status: string } | undefined;
    expect(block?.status).toBe("awaiting_confirmation");
    expect(block?.input).toEqual(question);
    await act(async () => root.unmount());
  });
});
