// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CoachMark } from "@/app/dashboard/_v3/tour/CoachMark";
import type { ResolvedTourStep } from "@/lib/dashboardV3/tour";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const step: ResolvedTourStep = { id: "s", anchor: "thing", route: "/x", title: "The thing", body: "What it does.", tours: ["detailed"], order: 1 };

function target(rect: { top: number; left: number; width: number; height: number }) {
  const el = document.createElement("button");
  el.setAttribute("data-tour", "thing");
  el.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON() {} }) as DOMRect;
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  return el;
}

async function mount(onMissing = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<CoachMark step={step} index={0} total={3} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} onPause={vi.fn()} onMissing={onMissing} />));
  return { root, onMissing };
}
const frames = async (n = 4) => {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the coach mark", () => {
  it("rings the exact element, puts the card beside it with an arrow, and follows it when it moves", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    let rect = { top: 100, left: 300, width: 200, height: 40 };
    const el = target(rect);
    await mount();
    await frames();
    const spot = document.querySelector<HTMLElement>(".plx-tour-spot")!;
    expect(spot).toBeTruthy();
    expect(spot.style.top).toBe("92px");
    expect(spot.style.left).toBe("292px");
    const card = document.querySelector<HTMLElement>(".plx-tour-card")!;
    expect(card.getAttribute("data-side")).toBe("bottom");
    expect(document.querySelector(".plx-tour-arrow")).toBeTruthy();
    expect(card.textContent).toContain("The thing");
    // Layout shifts: the ring follows without any scroll or resize event.
    rect = { top: 400, left: 300, width: 200, height: 40 };
    el.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, right: 500, bottom: 440, toJSON() {} }) as DOMRect;
    await frames();
    expect(document.querySelector<HTMLElement>(".plx-tour-spot")!.style.top).toBe("392px");
  });
  it("becomes a bottom sheet on a phone", async () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 667, configurable: true });
    target({ top: 100, left: 16, width: 300, height: 40 });
    await mount();
    await frames();
    const card = document.querySelector<HTMLElement>(".plx-tour-card")!;
    expect(card.className).toContain("plx-tour-card--sheet");
    expect(document.querySelector(".plx-tour-arrow")).toBeNull();
    expect(document.querySelector(".plx-tour-spot")).toBeTruthy();
  });
  it("skips on when its target is nowhere on the page", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date"] });
    const { onMissing } = await mount();
    for (let i = 0; i < 30; i++) await act(async () => { vi.advanceTimersByTime(200); });
    expect(onMissing).toHaveBeenCalledTimes(1);
  });
});
