// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/dashboard/_v3/sol/CreditModal", () => ({ CreditModal: () => <div data-testid="credit-modal" /> }));
vi.mock("@/lib/dashboardV3/siteCookie", () => ({ readCurrentSiteCookie: () => "hint_site" }));
Element.prototype.scrollIntoView = vi.fn();

import { SolStudio } from "@/app/dashboard/_v3/sol/studio/SolStudio";
import { useStudioChat } from "@/app/dashboard/_v3/sol/studio/useStudioChat";

const ndjson = (frames: unknown[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const f of frames) c.enqueue(enc.encode(`${JSON.stringify(f)}\n`)); c.close(); } }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
};

type Req = { url: string; body: Record<string, unknown> };
let reqs: Req[] = [];
let turns: Array<() => Response>;

beforeEach(() => {
  reqs = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    reqs.push({ url: String(url), body });
    if (String(url) === "/api/v1/sol/conversations") return new Response(JSON.stringify({ conversation: { id: "conv_1" } }), { status: 201 });
    const next = turns.shift();
    return next ? next() : new Response("{}", { status: 500 });
  }) as unknown as typeof fetch;
});

function Harness({ prompt }: { prompt: string }) {
  const engine = useStudioChat({ prompt, siteId: "site_12345" });
  return <SolStudio engine={engine} title="SOL" allowFollowUp />;
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const buttonWith = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
async function mount(prompt: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(<Harness prompt={prompt} />));
  await flush();
  await flush();
  return host;
}

describe("SOL Studio running a real SOL chat", () => {
  it("starts on its own for the site, shows SOL's step and answer, and links on to Ask SOL", async () => {
    turns = [() => ndjson([
      { type: "tool_call_start", id: "t1", name: "page_edit", label: "x", args: {} },
      { type: "tool_call_result", id: "t1", name: "page_edit", status: "success", result: {} },
      { type: "token", text: "I made your page faster." },
      { type: "message_done", messageId: "m1", usage: { inputTokens: 1, outputTokens: 1 } },
    ])];
    const host = await mount("Fix my speed");
    expect(reqs[0].url).toBe("/api/v1/sol/conversations");
    expect(reqs[1].url).toBe("/api/v1/sol/chat/conversations/conv_1/messages");
    expect(reqs[1].body).toMatchObject({ text: "Fix my speed", siteId: "site_12345", siteChosen: true, siteHintId: "hint_site" });
    expect(host.textContent).toContain("Fix my speed");
    expect(host.textContent).toContain("I made your page faster.");
    expect(host.textContent).toContain("Updated your page");
    expect(host.textContent).toContain("All done");
    expect(host.querySelector('a[href="/dashboard/sol/conv_1"]')).toBeTruthy();
  });

  it("stops for SOL's question, resumes with the answers, and carries on to the end", async () => {
    const q = { questions: [{ question: "Which page?", header: "Page", options: [{ label: "Home" }, { label: "About" }] }] };
    turns = [
      () => ndjson([{ type: "tool_call_awaiting_confirmation", id: "q1", name: "ask_user_question", args: q, messageId: "pending_1" }]),
      () => ndjson([{ type: "tool_call_result", id: "q1", name: "ask_user_question", status: "success", result: [{ question: "Which page?", answer: "Home" }] }, { type: "token", text: "Done with Home." }, { type: "message_done", messageId: "m2", usage: { inputTokens: 1, outputTokens: 1 } }]),
    ];
    const host = await mount("Change a page");
    expect(host.textContent).toContain("Which page?");
    expect(host.textContent).toContain("Waiting for your answer");

    await click(buttonWith(host, "Home"));
    await click(buttonWith(host, "Send my answers"));
    expect(reqs[2].url).toBe("/api/v1/sol/chat/conversations/conv_1/messages/pending_1/confirm");
    expect(reqs[2].body).toEqual({ answers: [{ question: "Which page?", answer: "Home" }] });
    expect(host.textContent).toContain("Done with Home.");
    expect(host.textContent).toContain("You answered 1 question");
    expect(host.textContent).toContain("All done");
  });

  it("shows a plain error and 'Try again' sends the same request once more", async () => {
    turns = [
      () => new Response(JSON.stringify({ error: "SOL is busy." }), { status: 503 }),
      () => ndjson([{ type: "token", text: "Back." }, { type: "message_done", messageId: "m3", usage: { inputTokens: 1, outputTokens: 1 } }]),
    ];
    const host = await mount("Do it");
    expect(host.textContent).toContain("SOL is busy.");
    await click(buttonWith(host, "Try again"));
    expect(reqs.filter((r) => r.url.endsWith("/messages")).map((r) => r.body.text)).toEqual(["Do it", "Do it"]);
    expect(host.textContent).toContain("Back.");
    // The failed attempt's message was taken back, so the request isn't shown twice.
    expect(host.textContent!.split("Do it").length - 1).toBe(1);
  });

  it("lets the owner ask for something else when SOL is done", async () => {
    turns = [
      () => ndjson([{ type: "token", text: "First." }, { type: "message_done", messageId: "m4", usage: { inputTokens: 1, outputTokens: 1 } }]),
      () => ndjson([{ type: "token", text: "Second." }, { type: "message_done", messageId: "m5", usage: { inputTokens: 1, outputTokens: 1 } }]),
    ];
    const host = await mount("One");
    const input = host.querySelector("input[aria-label='Ask SOL for something else']") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "And two");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(reqs.filter((r) => r.url.endsWith("/messages")).map((r) => r.body.text)).toEqual(["One", "And two"]);
    expect(host.textContent).toContain("Second.");
  });
});
