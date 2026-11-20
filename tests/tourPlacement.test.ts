import { describe, expect, it } from "vitest";
import { computePlacement, intersectBox, isInView, padBox, scrollDeltaForSheet, sideOrder, usesSheet, type Box } from "@/lib/dashboardV3/tourPlacement";

const vp = { width: 1200, height: 800 };
const card = { width: 360, height: 200 };
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
const cardBox = (p: { top: number; left: number }): Box => ({ ...p, ...card });

describe("computePlacement", () => {
  it("goes below when there is room, centred on the target", () => {
    const target = { top: 100, left: 500, width: 200, height: 40 };
    const p = computePlacement({ target, card, viewport: vp });
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(156);
    expect(p.left).toBe(600 - 180);
    expect(p.fits).toBe(true);
  });
  it("flips above when there is no room below", () => {
    const target = { top: 700, left: 500, width: 200, height: 40 };
    const p = computePlacement({ target, card, viewport: vp });
    expect(p.side).toBe("top");
    expect(p.top).toBe(700 - 16 - 200);
  });
  it("goes beside a tall target", () => {
    const target = { top: 20, left: 20, width: 220, height: 760 };
    const p = computePlacement({ target, card, viewport: vp });
    expect(p.side).toBe("right");
    expect(p.left).toBe(256);
    expect(overlaps(cardBox(p), target)).toBe(false);
  });
  it("honours a preferred side, falls back when it can't fit", () => {
    const target = { top: 300, left: 100, width: 100, height: 40 };
    expect(computePlacement({ target, card, viewport: vp, preferred: "right" }).side).toBe("right");
    expect(computePlacement({ target, card, viewport: vp, preferred: "left" }).side).toBe("right");
  });
  it("slides along the edge to stay on screen and keeps the arrow on the target", () => {
    const target = { top: 100, left: 1100, width: 60, height: 40 };
    const p = computePlacement({ target, card, viewport: vp });
    expect(p.left + card.width).toBeLessThanOrEqual(vp.width - 16);
    expect(p.arrowOffset).toBe(Math.min(1130 - p.left, card.width - 18));
    const left = computePlacement({ target: { top: 100, left: -10, width: 60, height: 40 }, card, viewport: vp });
    expect(left.left).toBe(16);
    expect(left.arrowOffset).toBeGreaterThanOrEqual(18);
  });
  it("never covers the target whenever it reports a fit", () => {
    for (let top = 0; top <= 760; top += 95) {
      for (let left = 0; left <= 1100; left += 130) {
        const target = { top, left, width: 100, height: 40 };
        const p = computePlacement({ target, card, viewport: vp });
        if (p.fits) expect(overlaps(cardBox(p), target)).toBe(false);
      }
    }
  });
  it("reports no fit when the target fills the screen (use the sheet)", () => {
    const p = computePlacement({ target: { top: 0, left: 0, width: 1200, height: 800 }, card, viewport: vp });
    expect(p.fits).toBe(false);
  });
  it("reports no fit on a phone", () => {
    const phone = { width: 375, height: 667 };
    const p = computePlacement({ target: { top: 250, left: 16, width: 343, height: 200 }, card: { width: 343, height: 260 }, viewport: phone });
    expect(p.fits).toBe(false);
  });
});

describe("sideOrder", () => {
  it("tries the preferred side then its opposite", () => {
    expect(sideOrder("left", { top: 1, bottom: 2, left: 3, right: 4 }).slice(0, 2)).toEqual(["left", "right"]);
    expect(sideOrder("auto", { top: 1, bottom: 2, left: 3, right: 4 })).toEqual(["bottom", "top", "right", "left"]);
  });
});

describe("boxes and scrolling", () => {
  it("intersects with a scrolled panel's visible area", () => {
    expect(intersectBox({ top: 50, left: 0, width: 100, height: 100 }, { top: 0, left: 0, width: 100, height: 100 })).toEqual({ top: 50, left: 0, width: 100, height: 50 });
    expect(intersectBox({ top: 200, left: 0, width: 10, height: 10 }, { top: 0, left: 0, width: 100, height: 100 })).toBeNull();
  });
  it("pads", () => {
    expect(padBox({ top: 10, left: 10, width: 10, height: 10 }, 4)).toEqual({ top: 6, left: 6, width: 18, height: 18 });
  });
  it("switches to the sheet on phones", () => {
    expect(usesSheet(375)).toBe(true);
    expect(usesSheet(1024)).toBe(false);
  });
  it("scrolls the target into the space above the sheet", () => {
    expect(scrollDeltaForSheet({ top: 100, left: 0, width: 100, height: 50 }, 700, 300)).toBe(0);
    expect(scrollDeltaForSheet({ top: 500, left: 0, width: 100, height: 50 }, 700, 300)).toBe(500 + 50 - (700 - 300 - 16));
    expect(scrollDeltaForSheet({ top: -40, left: 0, width: 100, height: 50 }, 700, 300)).toBe(-56);
    expect(scrollDeltaForSheet({ top: 200, left: 0, width: 100, height: 900 }, 700, 300)).toBe(184);
  });
  it("knows when a target is already in view", () => {
    expect(isInView({ top: 100, left: 0, width: 10, height: 10 }, vp)).toBe(true);
    expect(isInView({ top: 10, left: 0, width: 10, height: 10 }, vp)).toBe(false);
  });
});
