// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { TryNewEditorBanner } from "@/app/dashboard/templates/[id]/v2/TryNewEditor";
import { tryNewEditorKey } from "@/app/dashboard/templates/[id]/v2/logic";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(onTry = () => {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<TryNewEditorBanner templateId="t1" onTry={onTry} />));
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("the 'Try the new editor' banner", () => {
  it("is calm, offers the dialog, and can be dismissed for good on this page", async () => {
    let tried = 0;
    const el = await render(() => void tried++);
    expect(el.textContent).toContain("Try the new editor");
    await act(async () => (el.querySelector("button") as HTMLButtonElement).click());
    expect(tried).toBe(1);
    await act(async () => (el.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement).click());
    expect(el.textContent).toBe("");
    expect(localStorage.getItem(tryNewEditorKey("t1"))).toBe("1");
    document.body.innerHTML = "";
    expect((await render()).textContent).toBe("");
  });

  it("another page still gets its own banner", async () => {
    localStorage.setItem(tryNewEditorKey("other"), "1");
    expect((await render()).textContent).toContain("Try the new editor");
  });
});
