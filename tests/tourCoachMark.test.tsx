// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CoachMark } from "@/app/dashboard/_v3/tour/CoachMark";
import type { ResolvedTourStep } from "@/lib/dashboardV3/tour";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const liveRoots: ReturnType<typeof createRoot>[] = [];
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
  liveRoots.push(root);
  await act(async () => root.render(<CoachMark step={step} index={0} total={3} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} onPause={vi.fn()} onMissing={onMissing} />));
  return { root, onMissing };
}
const frames = async (n = 4) => {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

afterEach(async () => {
  // Take each step down the way the app does, so its frame loop stops before the page is wiped.
  await act(async () => { for (const r of liveRoots.splice(0)) r.unmount(); });
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

describe("a step that points at several things", () => {
  const multi: ResolvedTourStep = { ...step, id: "m", anchor: "box", anchors: ["box", "menu-item"], mascot: "sol", title: "Hi, I'm SOL", body: "I can build and change your website for you." };
  const named = (name: string, rect: { top: number; left: number; width: number; height: number }) => {
    const el = target(rect);
    el.setAttribute("data-tour", name);
    return el;
  };
  async function mountStep(s: ResolvedTourStep, onMissing = vi.fn()) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    liveRoots.push(root);
    await act(async () => root.render(<CoachMark step={s} index={0} total={3} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} onPause={vi.fn()} onMissing={onMissing} />));
    return { onMissing, root };
  }

  it("rings every visible anchor, with the card beside the first and one dim layer with a hole for each", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    named("box", { top: 20, left: 400, width: 440, height: 44 });
    named("menu-item", { top: 200, left: 16, width: 232, height: 44 });
    await mountStep(multi);
    await frames();
    const spots = document.querySelectorAll<HTMLElement>(".plx-tour-spot");
    expect(spots).toHaveLength(2);
    expect(spots[0].style.top).toBe("12px"); // the top bar box is first, so the card sits near it
    expect(spots[1].style.top).toBe("192px");
    expect(document.querySelectorAll(".plx-tour-dim mask rect")).toHaveLength(3); // the full-screen rect plus one hole per ring
    expect(document.querySelector(".plx-tour-card")!.getAttribute("data-side")).toBe("bottom");
  });

  it("never waits for the one that is hidden on this screen (a copy with no size)", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date"] });
    named("box", { top: 20, left: 400, width: 440, height: 44 });
    named("menu-item", { top: 0, left: 0, width: 0, height: 0 }); // display: none on this layout
    const { onMissing } = await mountStep(multi);
    for (let i = 0; i < 40; i++) await act(async () => { vi.advanceTimersByTime(200); });
    expect(onMissing).not.toHaveBeenCalled(); // well past the 3.5 s wait for a missing anchor
    expect(document.querySelectorAll(".plx-tour-spot")).toHaveLength(1);
    expect(document.querySelector(".plx-tour-dim")).toBeNull(); // a single ring keeps the plain spotlight
  });

  it("works with just the second anchor on screen, and skips only when none is", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    named("menu-item", { top: 200, left: 16, width: 232, height: 44 });
    await mountStep(multi);
    await frames();
    expect(document.querySelectorAll(".plx-tour-spot")).toHaveLength(1);
    expect(document.querySelector<HTMLElement>(".plx-tour-spot")!.style.top).toBe("192px");
  });

  it("on a phone leaves out a ring hidden under the bottom sheet", async () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 667, configurable: true });
    named("box", { top: 10, left: 120, width: 44, height: 44 });
    named("menu-item", { top: 610, left: 150, width: 70, height: 50 }); // the bottom bar, under the sheet
    await mountStep(multi);
    await frames();
    expect(document.querySelectorAll(".plx-tour-spot")).toHaveLength(1);
    expect(document.querySelector<HTMLElement>(".plx-tour-spot")!.style.top).toBe("2px");
  });

  it("shows SOL's mascot beside the title, as a labelled dialog the keyboard can leave", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    named("box", { top: 20, left: 400, width: 440, height: 44 });
    await mountStep(multi);
    await frames();
    const card = document.querySelector<HTMLElement>(".plx-tour-card")!;
    const art = card.querySelector<HTMLImageElement>(".plx-tour-card__head--mascot .plx-tour-mascot picture img");
    expect(art?.getAttribute("src")).toBe("/brand/sol/sol-wave.webp"); // the waving loop
    expect(card.querySelector(".plx-tour-mascot source[media='(prefers-reduced-motion: reduce)']")?.getAttribute("srcset")).toBe("/brand/sol/sol-wave-still.webp"); // still picture for reduced motion
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.getAttribute("aria-labelledby")).toBe("tour-m-title");
    expect(document.getElementById("tour-m-title")!.textContent).toBe("Hi, I'm SOL");
  });
});
