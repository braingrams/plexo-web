// @vitest-environment happy-dom
// @vitest-environment-options { "happyDOM": { "settings": { "disableCSSFileLoading": true, "disableJavaScriptFileLoading": true } } }
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), usePathname: () => "/dashboard" }));

async function mount(node: () => React.ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(node()); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return el;
}
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};
const byText = (root: ParentNode, text: string, sel = "button") => Array.from(root.querySelectorAll(sel)).find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement;

afterEach(() => { document.querySelectorAll("link").forEach((l) => l.remove()); document.body.innerHTML = ""; vi.unstubAllGlobals(); try { window.localStorage.clear(); } catch { /* none */ } });

describe("Your words (tagline and voice)", () => {
  it("loads what is saved, saves every field with one button and says so", async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init?.method ?? "GET", body });
      if (init?.method === "PUT") return new Response(JSON.stringify({ voice: body, message: "Saved. SOL and your AI helpers will now write in your voice." }), { status: 200 });
      return new Response(JSON.stringify({ voice: { tagline: "Fresh bread." }, effective: { tagline: "Fresh bread." } }), { status: 200 });
    }));
    const { BrandWords } = await import("@/app/dashboard/_v3/hub/BrandWords");
    const { ToastProvider } = await import("@/app/dashboard/_v3/ui");
    const el = await mount(() => <ToastProvider><BrandWords siteId="s1" siteName="Ama's Kitchen" /></ToastProvider>);
    const tagline = el.querySelector("input[placeholder^='e.g. Fresh bread']") as HTMLInputElement;
    expect(tagline.value).toBe("Fresh bread.");
    expect(el.textContent).toContain("Write it for me");
    expect(el.textContent).not.toMatch(/Strata|token|prompt/i);
    const save = byText(el, "Save my words");
    expect(save.disabled).toBe(true);
    await type(tagline, "Fresh bread, baked slow.");
    await act(async () => { byText(el, "Warm").click(); byText(el, "Casual").click(); });
    expect(el.textContent).toContain("You have changes to save.");
    await act(async () => { save.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ tagline: "Fresh bread, baked slow.", tones: ["warm"], formality: "casual", wordsLike: [], wordsAvoid: [] });
    expect(el.textContent).toContain("Saved.");
  });

  it("limits tones with a plain explanation and keeps words as removable chips", async () => {
    const { BrandWords } = await import("@/app/dashboard/_v3/hub/BrandWords");
    const { ToastProvider } = await import("@/app/dashboard/_v3/ui");
    const el = await mount(() => <ToastProvider><BrandWords siteId="s1" siteName="Ama" preview previewVoice={{ tones: ["warm", "calm", "bold", "expert"], wordsAvoid: ["cheap"] }} /></ToastProvider>);
    await act(async () => { byText(el, "Playful").click(); });
    expect(el.textContent).toMatch(/Pick up to 4 tones/);
    const remove = el.querySelector("button[aria-label='Remove cheap']") as HTMLButtonElement;
    await act(async () => { remove.click(); });
    expect(el.textContent).not.toContain("cheap ×");
    expect(el.textContent).toContain("You have changes to save.");
  });
});

describe("Font picker", () => {
  it("shows the chosen font, then searches, filters, favourites and chooses with a weight", async () => {
    const chosen: Array<[string, number]> = [];
    const { FontField } = await import("@/app/dashboard/_v3/hub/FontPicker");
    const el = await mount(() => <FontField label="Headings" hint="Titles" value="Lora" weight={700} customFonts={[]} siteId="s1" onChange={(f, w) => chosen.push([f, w])} />);
    expect(el.textContent).toContain("Lora");
    expect(el.textContent).toContain("Bold");
    await act(async () => { (el.querySelector("button.plx-fp__current") as HTMLButtonElement).click(); });
    const dialog = document.body;
    const search = dialog.querySelector("input[type=search]") as HTMLInputElement;
    expect(search.placeholder).toMatch(/^Search 1,\d{3} fonts$/);
    await type(search, "pacif");
    expect(dialog.querySelectorAll(".plx-fp__row").length).toBe(1);
    expect(dialog.textContent).toContain("Pacifico");
    await type(search, "");
    await act(async () => { byText(dialog, "Handwritten").click(); });
    expect(Array.from(dialog.querySelectorAll(".plx-fp__row")).length).toBe(40);
    await type(search, "pacif");
    await act(async () => { (dialog.querySelector("button[aria-label='Add Pacifico to favourites']") as HTMLButtonElement).click(); });
    expect(window.localStorage.getItem("plexo.fonts.favourites")).toBe('["Pacifico"]');
    await act(async () => { (dialog.querySelector(".plx-fp__pick") as HTMLButtonElement).click(); });
    // Pacifico has one weight: the picker snaps to it rather than asking Google for a weight that doesn't exist.
    expect(dialog.querySelectorAll("[role=radiogroup][aria-label=Weight] button").length).toBe(1);
    await act(async () => { byText(dialog, "Use Pacifico").click(); });
    expect(chosen).toEqual([["Pacifico", 400]]);
  });

  it("only requests a font's preview once it is on screen, and offers upload under My fonts", async () => {
    const seen: Array<() => void> = [];
    vi.stubGlobal("IntersectionObserver", class { constructor(cb: IntersectionObserverCallback) { seen.push(() => cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never)); } observe() {} disconnect() {} });
    const { FontPickerModal } = await import("@/app/dashboard/_v3/hub/FontPicker");
    await mount(() => <FontPickerModal open onClose={() => {}} title="Pick" value="Inter" weight={400} customFonts={[]} siteId="s1" onChoose={() => {}} />);
    const previews = () => Array.from(document.head.querySelectorAll("link[rel=stylesheet]")).filter((l) => (l as HTMLLinkElement).href.includes("&text=")).length;
    expect(previews()).toBe(0);
    await act(async () => { seen.slice(0, 3).forEach((f) => f()); });
    expect(previews()).toBe(3);
    await act(async () => { byText(document.body, "My fonts").click(); });
    expect(document.body.textContent).toContain("Upload my own font");
    expect(document.body.textContent).toContain("You haven't uploaded a font yet.");
    expect(document.head.querySelector("link[rel=preconnect][href='https://fonts.gstatic.com']")).toBeTruthy();
  });

  it("recommended pairs set both fonts at once", async () => {
    const { FontPairs } = await import("@/app/dashboard/_v3/hub/FontPicker");
    const picked: string[] = [];
    const el = await mount(() => <FontPairs heading="Inter" body="Inter" onPair={(p) => picked.push(`${p.heading}+${p.body}`)} />);
    expect(el.textContent).toContain("Fonts that go well together");
    await act(async () => { (el.querySelector(".plx-fp__paircards button") as HTMLButtonElement).click(); });
    expect(picked).toEqual(["Playfair Display+Source Sans 3"]);
  });
});
