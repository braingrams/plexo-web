// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/dashboard/_v3/sol/CreditModal", () => ({ CreditModal: ({ creditInfo }: { creditInfo: { availableCredits: number } }) => <div data-testid="credit-modal">credits {creditInfo.availableCredits}</div> }));
Element.prototype.scrollIntoView = vi.fn();

import { PersonalizeStudio } from "@/app/dashboard/_v3/newsite/PersonalizeStudio";

type Call = { stage: string; body: Record<string, unknown> };
let calls: Call[] = [];
let handler: (c: Call) => { status?: number; json: unknown };

const QUESTIONS = [{ header: "Where you are", question: "Where is your gym?", options: [{ label: "Lagos, Nigeria" }, { label: "I'll add it later" }] }];

beforeEach(() => {
  calls = [];
  handler = (c) => {
    if (c.stage === "plan") return { json: { domain: "fitness", summary: "", questions: QUESTIONS } };
    if (c.stage === "write") return { json: { replacements: { "1": "MUSTI" } } };
    return { json: { html: "<html>done</html>", summary: "SOL wrote your words.", creditsRemaining: 7 } };
  };
  globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ stage: body.stage, body });
    const r = handler({ stage: body.stage, body });
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const buttonWith = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

async function mount(onApplied = vi.fn(), onClose = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(<PersonalizeStudio profile={{ goal: "business-site", brand: { name: "Musti", about: "a gym" } }} design={{ id: "d1", name: "Iron & Grain", html: "<html><body><h1>x</h1></body></html>" }} creditCost={5} onApplied={onApplied} onClose={onClose} />));
  await flush();
  return { host, onApplied, onClose };
}

describe("SOL Studio personalizing a design", () => {
  it("reads the design, asks SOL's real question, writes, then hands back the new design", async () => {
    const { host, onApplied } = await mount();
    expect(calls.map((c) => c.stage)).toEqual(["plan"]);
    expect(host.textContent).toContain("Where is your gym?");
    expect(host.textContent).toContain("Waiting for your answer");
    // No jargon or fake steps: the plain labels of the real stages.
    expect(host.textContent).toContain("Read your brand and this design");

    await click(buttonWith(host, "Lagos, Nigeria"));
    await click(buttonWith(host, "Send my answers"));
    expect(calls.map((c) => c.stage)).toEqual(["plan", "write", "finish"]);
    expect(calls[1].body.answers).toEqual([{ question: "Where is your gym?", answer: "Lagos, Nigeria" }]);
    expect(calls[2].body).toMatchObject({ replacements: { "1": "MUSTI" }, domain: "fitness" });
    expect(onApplied).toHaveBeenCalledWith({ html: "<html>done</html>", summary: "SOL wrote your words.", creditsRemaining: 7 });
    expect(host.textContent).toContain("All done");
    expect(buttonWith(host, "See my design")).toBeTruthy();
  });

  it("skips the questions when SOL has none", async () => {
    handler = (c) => (c.stage === "plan" ? { json: { domain: "other", summary: "", questions: [] } } : c.stage === "write" ? { json: { replacements: { "0": "x" } } } : { json: { html: "<html>ok</html>", summary: "" } });
    const { onApplied } = await mount();
    expect(calls.map((c) => c.stage)).toEqual(["plan", "write", "finish"]);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("on a failure explains it, and 'Try again' does not redo (or re-charge) finished steps or re-ask", async () => {
    let writeFails = true;
    handler = (c) => {
      if (c.stage === "plan") return { json: { domain: "fitness", summary: "", questions: QUESTIONS } };
      if (c.stage === "write") return writeFails ? { status: 500, json: { error: "SOL hit a snag while personalizing. Please try again: nothing was changed." } } : { json: { replacements: { "1": "MUSTI" } } };
      return { json: { html: "<html>done</html>", summary: "" } };
    };
    const { host, onApplied } = await mount();
    await click(buttonWith(host, "Lagos, Nigeria"));
    await click(buttonWith(host, "Send my answers"));
    expect(host.textContent).toContain("SOL hit a snag while personalizing");
    expect(onApplied).not.toHaveBeenCalled();

    writeFails = false;
    await click(buttonWith(host, "Try again"));
    expect(calls.map((c) => c.stage)).toEqual(["plan", "write", "write", "finish"]);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("out of credits opens the top-up instead of a dead end", async () => {
    handler = () => ({ status: 402, json: { outOfCredits: true, availableCredits: 2, error: "x" } });
    const { host, onApplied } = await mount();
    expect(host.querySelector('[data-testid="credit-modal"]')?.textContent).toContain("credits 2");
    expect(host.textContent).toContain("needs more AI credits");
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("Stop leaves without changing the design, even if SOL answers later", async () => {
    let release: (() => void) | undefined;
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify({ domain: "x", summary: "", questions: [] }))); })) as unknown as typeof fetch;
    const { host, onApplied, onClose } = await mount();
    await click(buttonWith(host, "Stop"));
    expect(onClose).toHaveBeenCalled();
    release?.();
    await flush();
    expect(onApplied).not.toHaveBeenCalled();
  });
});
