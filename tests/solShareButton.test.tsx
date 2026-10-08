// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShareButton } from "@/app/dashboard/sol/_components/ShareButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const url = "https://plexo.charisol.io/share/sol/abc";
const calls: string[] = [];
vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
  calls.push(init?.method ?? "GET");
  const shared = init?.method === "POST";
  return new Response(JSON.stringify(shared ? { shared: true, url, upTo: "2026-10-08T18:00:00.000Z" } : { shared: false, url: null, upTo: null }), { status: 200 });
}));
const writeText = vi.fn(async () => {});
Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

const roots: Root[] = [];
const mount = async (header: HTMLElement) => {
  const root = createRoot(header);
  roots.push(root);
  await act(async () => root.render(<ShareButton conversationId="c1" />));
};

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  calls.length = 0;
});

const press = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("the SOL Share panel", () => {
  it("opens on top of the page (not inside the header), creates the link, copies it and says so", async () => {
    const header = document.createElement("header");
    document.body.appendChild(header);
    await mount(header);

    await press(header.querySelector("button")!);
    await flush();
    const panel = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(header.contains(panel)).toBe(false); // drawn over everything, not under the chat
    expect(panel.style.position).toBe("fixed");

    const create = [...panel.querySelectorAll("button")].find((b) => b.textContent?.includes("Create link"))!;
    await press(create);
    await flush();

    expect(calls).toContain("POST");
    expect(writeText).toHaveBeenCalledWith(url);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(); // still open
    expect(document.querySelector('[role="status"]')?.textContent).toMatch(/Link copied/);
    expect((document.querySelector('input[aria-label="Share link"]') as HTMLInputElement).value).toBe(url);
  });

  it("closes on a click outside it, or Escape", async () => {
    const header = document.createElement("header");
    document.body.appendChild(header);
    await mount(header);
    await press(header.querySelector("button")!);
    await flush();
    await press(document.body);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await press(header.querySelector("button")!);
    await flush();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
