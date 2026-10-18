// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ChatDock, useChatDrawer } from "@/app/dashboard/apps/_components/ChatDock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounts = 0;
function Conversation() {
  const [draft, setDraft] = useState("");
  // Counts real mounts: the chat must never remount when the drawer opens or closes.
  useState(() => void (mounts += 1));
  return <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />;
}

// Mirrors how AppEditor wires it: one chat, placed by the current tab.
function Harness() {
  const [tab, setTab] = useState<"preview" | "design">("preview");
  const overlay = tab === "design";
  const drawer = useChatDrawer(overlay);
  return (
    <div>
      <button onClick={() => setTab(tab === "design" ? "preview" : "design")}>switch</button>
      <button onClick={drawer.toggleDrawer}>chat</button>
      <button onClick={drawer.openDrawer}>ask sol</button>
      <button onClick={drawer.noteArrival}>arrived</button>
      <span data-testid="unread">{String(drawer.unread)}</span>
      <ChatDock overlay={overlay} open={drawer.open} mobileActive={false} onClose={drawer.closeDrawer}>
        <Conversation />
      </ChatDock>
    </div>
  );
}

const roots: Root[] = [];
const mount = async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<Harness />));
};
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  mounts = 0;
});

const click = (label: string) => act(async () => void [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click());
const placement = () => document.querySelector("aside")!.getAttribute("data-placement");

describe("chat dock", () => {
  it("is docked on other tabs and has no close bar", async () => {
    await mount();
    expect(placement()).toBe("docked");
    expect(document.querySelector(".ed-chat-bar")).toBeNull();
    await click("ask sol"); // nothing to open when it's already docked
    expect(placement()).toBe("docked");
  });

  it("is a closed drawer on Design, opens on the button and on Ask SOL, closes on Esc and the close button", async () => {
    await mount();
    await click("switch");
    expect(placement()).toBe("drawer-closed");
    await click("chat");
    expect(placement()).toBe("drawer-open");
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(placement()).toBe("drawer-closed");
    await click("ask sol");
    expect(placement()).toBe("drawer-open");
    await act(async () => void (document.querySelector('[aria-label="Close chat"]') as HTMLButtonElement).click());
    expect(placement()).toBe("drawer-closed");
  });

  it("keeps the same conversation (and draft) through every move", async () => {
    await mount();
    const input = () => document.querySelector("input") as HTMLInputElement;
    const first = input();
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(first, "hello");
      first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("switch");
    await click("chat");
    await click("switch");
    expect(input()).toBe(first);
    expect(input().value).toBe("hello");
    expect(mounts).toBe(1);
  });

  it("closes when you leave Design, and flags an answer that arrived while it was closed", async () => {
    await mount();
    await click("switch");
    await click("arrived");
    expect(document.querySelector('[data-testid="unread"]')!.textContent).toBe("true");
    await click("chat");
    expect(document.querySelector('[data-testid="unread"]')!.textContent).toBe("false");
    await click("switch");
    await click("switch");
    expect(placement()).toBe("drawer-closed");
  });
});
