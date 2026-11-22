// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), usePathname: () => "/dashboard" }));

const LINKED = { linked: true, projectId: "p1", projectName: "Home", autoSync: true, status: "active", updatedAt: null, lastCheckedAt: null, lastResult: null, lastResultKind: null, lastSource: null, useOnSite: false, canUseOnSite: false, resolved: { source: "strata", siteId: "s1", linked: true, project: { id: "p1", name: "Home" }, syncOn: true, status: "active", colours: [{ role: "primary", label: "Main", value: "#1F6FEB" }], fonts: {}, components: [], stylesheet: null } };

async function mount(node: () => React.ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(node()); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return el;
}
afterEach(() => { document.querySelectorAll("link").forEach((l) => l.remove()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

describe("Your brand: saved state", () => {
  it("shows a calm saved state with the brand selected, no connect heading and no tool name", async () => {
    const { BrandSaved } = await import("@/app/dashboard/_v3/hub/BrandTab");
    const { ToastProvider } = await import("@/app/dashboard/_v3/ui");
    const el = await mount(() => <ToastProvider><BrandSaved siteId="s1" siteName="Ama's Kitchen" isRaw={false} preview previewState={LINKED as never} /></ToastProvider>);
    const text = el.textContent ?? "";
    expect(text).toContain("Your brand is saved");
    expect(text).toContain("Home");
    expect(text).toContain("is selected");
    expect(text).toContain("Saved");
    expect(text).toContain("Switch brand");
    expect(text).toContain("Saved to your design system");
    expect(text).not.toMatch(/Connect your|Strata|Send to/);
  });

  it("saves a brand that isn't saved yet by itself (no button) and then shows it selected", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push(`${init?.method ?? "GET"} ${body ? Object.keys(body)[0] : ""}`.trim());
      const linked = body?.sendToStrata === true;
      return new Response(JSON.stringify({ ...LINKED, linked, projectId: linked ? "p1" : null, projectName: linked ? "Ama's Kitchen" : null }), { status: 200 });
    }));
    const client = { available: async () => true, status: async () => ({ connected: true }), connect: async () => ({ connected: true }), listProjects: async () => [] };
    const { BrandSaved } = await import("@/app/dashboard/_v3/hub/BrandTab");
    const { ToastProvider } = await import("@/app/dashboard/_v3/ui");
    const el = await mount(() => <ToastProvider><BrandSaved siteId="s1" siteName="Ama's Kitchen" isRaw={false} client={client as never} /></ToastProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(calls).toContain("POST sendToStrata");
    expect(el.textContent).toContain("Your brand is saved");
    expect(el.textContent).toContain("Ama's Kitchen");
    expect(el.textContent).not.toMatch(/Send to|Strata/);
  });
});

describe("Your brand: help", () => {
  it("opens a friendly panel for three kinds of reader, and names the tool only there", async () => {
    const { BrandHelp } = await import("@/app/dashboard/_v3/hub/BrandHelp");
    const onSwitch = vi.fn();
    const el = await mount(() => <BrandHelp onSwitch={onSwitch} />);
    expect(el.textContent).not.toMatch(/Strata/);
    const btn = el.querySelector("button[aria-label='What is my brand?']") as HTMLButtonElement;
    await act(async () => { btn.click(); });
    const text = document.body.textContent ?? "";
    expect(text).toContain("New to this?");
    expect(text).toContain("a tool called Strata");
    expect(text).toContain("Already use Strata?");
    expect(text).toContain("Try Strata");
    const sw = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Switch brand") as HTMLButtonElement;
    await act(async () => { sw.click(); });
    expect(onSwitch).toHaveBeenCalled();
  });
});

describe("Your brand: definition", () => {
  it("picking a style fills in the colours and the preview follows", async () => {
    const { BrandDefinition } = await import("@/app/dashboard/_v3/hub/BrandDefinition");
    const { ToastProvider } = await import("@/app/dashboard/_v3/ui");
    const el = await mount(() => <ToastProvider><BrandDefinition siteId="s1" siteName="Ama's Kitchen" own={{ colors: ["#1F6FEB"] }} defaults={null} sourceType="BUILDER" /></ToastProvider>);
    expect(el.textContent).toContain("Your brand definition");
    const before = el.querySelector("[data-testid=brand-preview] button")?.getAttribute("style") ?? "";
    const bold = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Bold and modern")) as HTMLButtonElement;
    await act(async () => { bold.click(); });
    const after = el.querySelector("[data-testid=brand-preview] button")?.getAttribute("style") ?? "";
    expect(after).not.toBe(before);
    expect(el.textContent).toContain("You have changes to save");
    expect(el.textContent).not.toMatch(/Strata/);
  });
});
