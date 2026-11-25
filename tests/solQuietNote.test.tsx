// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageList } from "@/app/dashboard/sol/_components/MessageList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};

// Streamily on staging: one AI call took ~5 minutes and the chat showed only three dots the
// whole time — it looked frozen. After a long quiet spell it now says it's still working.

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const render = async (root: ReturnType<typeof createRoot>, blocks: unknown[]) =>
  act(async () => root.render(<MessageList messages={[]} conversationId="c1" pendingBlocks={blocks as never} streaming />));

describe("when SOL goes quiet for a while", () => {
  it("says it's still working, and starts counting again when something arrives", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await render(root, [{ type: "text", text: "Let's start." }]);
    expect(container.textContent).not.toContain("Still working");

    await act(async () => vi.advanceTimersByTime(50_000));
    expect(container.textContent).toContain("taking longer than usual");

    await act(async () => vi.advanceTimersByTime(80_000));
    expect(container.textContent).toContain("SOL is slow right now");

    await render(root, [{ type: "text", text: "Let's start. Now the pages." }]);
    expect(container.textContent).not.toContain("Still working");
    await act(async () => root.unmount());
  });
});
