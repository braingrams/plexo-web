// @vitest-environment happy-dom
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A fake editor that records what the host handed it, so we can act as the editor's Save menu and Autosave would.
let captured: Record<string, any> = {};
vi.mock("@charisol/plexo-sdk/v2", async () => {
  const React = await import("react");
  return {
    V2Editor: React.forwardRef(function FakeEditor(props: Record<string, any>, ref: any) {
      captured = props;
      React.useImperativeHandle(ref, () => ({ getPages: () => [{ id: "p" }], getDesignSystem: () => ({}), getNodeRect: () => null }));
      return React.createElement("div", { "data-testid": "fake-editor" });
    }),
  };
});
vi.mock("@charisol/plexo-sdk/dist/plexo-sdk.css", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../app/dashboard/_components/EditorTheme", () => ({ useEditorColors: () => null, useEditorV3: () => false, useSitesListHref: () => "/dashboard/sites" }));
vi.mock("../app/dashboard/apps/_components/strataAdapter", () => ({ createStrataAdapter: () => ({ available: async () => false }) }));
vi.mock("../app/dashboard/templates/[id]/v2/PageSettings", () => ({ PageSettings: () => null }));

import { V2TemplateEditor } from "../app/dashboard/templates/[id]/v2/V2TemplateEditor";

const design = { format: "plexo-v2", pages: [{ id: "p", name: "Home", rootNode: { id: "r", type: "Page", children: [] } }] } as any;
const baseProps = {
  templateId: "t1", templateName: "Home", rootTemplateId: "t1", initialDesign: design, kind: "LANDING_PAGE" as const, commentMode: false,
  onRequestComment: () => undefined, stockKeys: {}, headerRight: null, onPublish: async () => undefined, onBack: () => undefined, onSaved: () => undefined, readOnly: false, canGoBack: false,
};

let saves: number;
let activeSaves: number;
let maxActive: number;
beforeEach(() => {
  saves = 0; activeSaves = 0; maxActive = 0; captured = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    if (String(url).startsWith("/api/templates/update/")) {
      saves++; activeSaves++; maxActive = Math.max(maxActive, activeSaves);
      await new Promise((r) => setTimeout(r, 20));
      activeSaves--;
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (String(url).includes("/pages")) return { ok: true, json: async () => ({ rootId: "t1", pages: [{ id: "t1", name: "Home", slug: null, parentId: null, order: 0 }] }) };
    return { ok: true, json: async () => ({ sectionTypes: [] }) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function mount(extra: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<V2TemplateEditor {...baseProps} {...(extra as object)} />); });
  for (let i = 0; i < 20 && !captured.onChange; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return root;
}

describe("V2TemplateEditor host wiring", () => {
  it("hands the editor every host prop", async () => {
    await mount({ hasAddress: true, onAskSolManyPages: () => undefined });
    for (const p of ["onSave", "onSaveDraft", "onPublish", "autosavePreference", "onAskSolManyPages"]) expect(captured[p], p).toBeTypeOf(p === "autosavePreference" ? "object" : "function");
    expect(captured.hasAddress).toBe(true);
    expect(captured.saveState).toBeUndefined(); // the editor tracks saving itself, so its Autosave switch shows
  });

  it("viewers get no saving, publishing or SOL-on-many-pages", async () => {
    await mount({ readOnly: true, onAskSolManyPages: () => undefined });
    for (const p of ["onSave", "onSaveDraft", "onPublish", "onAskSolManyPages"]) expect(captured[p], p).toBeUndefined();
  });

  it("a burst of autosaves never overlaps", async () => {
    await mount();
    await act(async () => { await Promise.all([captured.onSave(), captured.onSave(), captured.onSave(), captured.onSave()]); });
    expect(maxActive).toBe(1);
    expect(saves).toBeLessThanOrEqual(2);
  });

  it("waits while the page is going live, then saves", async () => {
    const root = await mount({ savePaused: true });
    let done = false;
    act(() => { void captured.onSave().then(() => { done = true; }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(saves).toBe(0);
    expect(done).toBe(false);
    await act(async () => { root.render(<V2TemplateEditor {...baseProps} savePaused={false} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(saves).toBe(1);
    expect(done).toBe(true);
  });

  it("Save as draft saves, and offline says so in plain words without calling the server", async () => {
    await mount();
    await act(async () => { await captured.onSaveDraft(); });
    expect(saves).toBe(1);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await expect(captured.onSave()).rejects.toThrow(/offline/);
    expect(saves).toBe(1);
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("Publish now is the page's own publish", async () => {
    const onPublish = vi.fn(async () => undefined);
    await mount({ onPublish });
    await act(async () => { await captured.onPublish(); });
    expect(onPublish).toHaveBeenCalled();
  });
});
