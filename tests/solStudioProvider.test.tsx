// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/dashboard/_v3/sol/CreditModal", () => ({ CreditModal: () => null }));
vi.mock("@/lib/dashboardV3/siteCookie", () => ({ readCurrentSiteCookie: () => undefined }));
Element.prototype.scrollIntoView = vi.fn();

import { SolStudioProvider, useSolStudio } from "@/app/dashboard/_v3/sol/studio/SolStudioProvider";
import { solStudioHref } from "@/lib/dashboardV3/solStudioLink";

const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
beforeEach(() => {
  sent.length = 0;
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (String(url) === "/api/v1/sol/conversations") return new Response(JSON.stringify({ conversation: { id: "c1" } }), { status: 201 });
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(`${JSON.stringify({ type: "token", text: "On it." })}\n${JSON.stringify({ type: "message_done", messageId: "m", usage: { inputTokens: 1, outputTokens: 1 } })}\n`)); c.close(); } }), { status: 200 });
  }) as unknown as typeof fetch;
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function Screen() {
  const studio = useSolStudio();
  return (
    <div>
      <a id="studio" href={solStudioHref("Connect my domain.", { siteId: "site_12345" })}>Let SOL do it</a>
      <a id="plain" href="/dashboard/sol?new=1&draft=Write%20an%20email%20for%20">Ask SOL</a>
      <a id="newtab" target="_blank" href={solStudioHref("Another one.")}>New tab</a>
      <button id="script" onClick={() => studio.runScript({ title: "Fixing", script: async (api) => api.step("sol_fix_site", async () => 1) })}>Fix</button>
    </div>
  );
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  host.addEventListener("click", (e) => e.preventDefault()); // a real browser would navigate; the test only looks at what the studio did
  await act(async () => createRoot(host).render(<SolStudioProvider><Screen /></SolStudioProvider>));
  return host;
}
const press = async (el: Element | null, init: MouseEventInit = {}) => { await act(async () => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })); }); await flush(); await flush(); };

describe("SOL Studio from any screen", () => {
  it("a 'Let SOL do it' link opens the studio right here and SOL starts for that site", async () => {
    const host = await mount();
    await press(host.querySelector("#studio"));
    expect(document.body.textContent).toContain("On it.");
    expect(sent.find((r) => r.url.endsWith("/messages"))?.body).toMatchObject({ text: "Connect my domain.", siteId: "site_12345" });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await press([...document.querySelectorAll("button")].find((b) => b.textContent === "Done") ?? null);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("leaves ordinary Ask SOL links, new-tab clicks and modified clicks alone", async () => {
    const host = await mount();
    await press(host.querySelector("#plain"));
    await press(host.querySelector("#newtab"));
    await press(host.querySelector("#studio"), { metaKey: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("runs real work as steps from code too", async () => {
    const host = await mount();
    await press(host.querySelector("#script"));
    expect(document.body.textContent).toContain("Fixed your site");
    expect(document.body.textContent).toContain("All done");
  });
});
