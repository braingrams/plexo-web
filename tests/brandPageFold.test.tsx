// @vitest-environment happy-dom
// @vitest-environment-options { "happyDOM": { "settings": { "disableCSSFileLoading": true, "disableJavaScriptFileLoading": true } } }
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), usePathname: () => "/dashboard" }));

const RESOLVED = { source: "strata", siteId: "s1", linked: true, project: { id: "p1", name: "Ama's brand" }, syncOn: true, status: "active", name: "Ama's Kitchen", tagline: "Fresh bread, baked slow.", words: { tagline: "Fresh bread, baked slow.", tones: ["warm"], formality: "casual" }, colours: [{ role: "primary", label: "Main colour (buttons, links)", value: "#E4572E" }, { role: "secondary", label: "Second colour", value: "#2B2D42" }], fonts: { heading: "Fraunces", body: "Work Sans" }, fontWeights: { heading: 700 }, components: [], stylesheet: null };
const LINKED = { linked: true, projectId: "p1", projectName: "Ama's brand", autoSync: true, status: "active", updatedAt: null, lastCheckedAt: null, lastResult: null, lastResultKind: null, lastSource: null, useOnSite: false, canUseOnSite: false, resolved: RESOLVED };
const FIRST = { ...LINKED, linked: false, projectId: null, projectName: null, resolved: { ...RESOLVED, linked: false, project: null, colours: [], fonts: {}, tagline: undefined, words: undefined } };
const client = { available: async () => true, status: async () => ({ connected: true }), connect: async () => ({ connected: true }), listProjects: async () => [] };

async function mount(state: unknown) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("site-meta") ? { htmlTitle: "", favicon: "", metaDescription: "", ogImageUrl: "" } : {}), { status: 200 })));
  const { BrandTab } = await import("@/app/dashboard/_v3/hub/BrandTab");
  const { ToastProvider } = await import("@/app/dashboard/_v3/ui");
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<ToastProvider><BrandTab siteId="s1" siteName="Ama's Kitchen" brand={null} strataClient={client as never} strataPreviewState={state as never} strataPreviewVoice={{ tagline: "Fresh bread, baked slow." }} /></ToastProvider>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return el;
}
const btn = (root: ParentNode, text: string) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const type = async (input: HTMLInputElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); };

afterEach(() => { document.body.innerHTML = ""; document.head.querySelectorAll("link").forEach((l) => l.remove()); vi.unstubAllGlobals(); });

describe("Your brand: folded editor", () => {
  it("shows only a compact summary card once a brand is set up", async () => {
    const el = await mount(LINKED);
    const summary = el.querySelector("[data-testid=brand-summary]")!;
    expect(summary).toBeTruthy();
    expect(summary.textContent).toContain("Fresh bread, baked slow.");
    expect(summary.textContent).toContain("Fraunces");
    expect(summary.textContent).toContain("Work Sans");
    expect(summary.querySelectorAll(".plx-bible__dots li")).toHaveLength(2);
    expect(el.textContent).toContain("Saved");
    expect(btn(el, "Edit brand")).toBeTruthy();
    expect(btn(el, "Switch brand")).toBeTruthy();
    expect(el.textContent).not.toContain("Your brand definition");
    expect(el.querySelector("[data-tour=hub-brand-words]")).toBeNull();
  });

  it("opens the full editor with Edit brand, and Done folds it away again", async () => {
    const el = await mount(LINKED);
    await act(async () => { btn(el, "Edit brand").click(); });
    expect(el.textContent).toContain("Your brand definition");
    expect(el.textContent).toContain("Your words");
    expect(el.textContent).toContain("Fonts that go well together");
    expect(btn(el, "Edit brand")).toBeUndefined();
    await act(async () => { btn(el, "Done").click(); });
    expect(el.textContent).not.toContain("Your brand definition");
    expect(btn(el, "Edit brand")).toBeTruthy();
  });

  it("guards unsaved changes: Keep editing stays, Leave without saving discards", async () => {
    const el = await mount(LINKED);
    await act(async () => { btn(el, "Edit brand").click(); });
    await type(el.querySelector("input[placeholder^='e.g. Fresh bread']") as HTMLInputElement, "A new line");
    await act(async () => { btn(el, "Cancel").click(); });
    expect(document.body.textContent).toContain("Leave without saving?");
    await act(async () => { btn(document.body, "Keep editing").click(); });
    expect(el.textContent).toContain("Your brand definition");
    await act(async () => { btn(el, "Done").click(); });
    await act(async () => { btn(document.body, "Leave without saving").click(); });
    expect(el.textContent).not.toContain("Your brand definition");
    expect(btn(el, "Edit brand")).toBeTruthy();
  });

  it("first-time set-up shows the full flow, with no Edit brand or Done", async () => {
    const el = await mount(FIRST);
    expect(el.textContent).toContain("Your brand definition");
    expect(el.textContent).toContain("Your words");
    expect(btn(el, "Edit brand")).toBeUndefined();
    expect(btn(el, "Done")).toBeUndefined();
    expect(el.querySelector("[data-testid=brand-summary]")).toBeNull();
  });
});
