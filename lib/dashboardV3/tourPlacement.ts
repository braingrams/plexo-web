/**
 * Where the tour's card goes, as pure maths (no DOM) so it can be tested. Everything is in one
 * coordinate space (the viewport, in the dashboard's own units).
 *
 * The rules: the card never covers the thing it describes. It tries the preferred side, then the
 * other sides in order of free room, and slides along that side to stay on screen. The arrow
 * points from the card edge at the target's centre. When no side has room (a phone, a huge
 * target) the caller uses the bottom sheet and scrolls the target into the space above it.
 */
export type Box = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Side = "top" | "bottom" | "left" | "right";

export type PlacementInput = {
  target: Box;
  card: Size;
  viewport: Size;
  preferred?: Side | "auto";
  /** Space between the target's highlight and the card (room for the arrow). */
  gap?: number;
  /** Minimum space between the card and the screen edge. */
  margin?: number;
  /** Arrow half-width; the arrow stays this far from the card's corners. */
  arrowInset?: number;
};

export type Placement = {
  /** The side of the TARGET the card sits on. */
  side: Side;
  top: number;
  left: number;
  /** Where the arrow sits along the card edge facing the target, in px from the card's start. */
  arrowOffset: number;
  /** False when no side fits without covering the target: use the bottom sheet. */
  fits: boolean;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));

export function spaceAround(target: Box, viewport: Size, margin: number) {
  return {
    top: target.top - margin,
    bottom: viewport.height - (target.top + target.height) - margin,
    left: target.left - margin,
    right: viewport.width - (target.left + target.width) - margin,
  } satisfies Record<Side, number>;
}

function needed(side: Side, card: Size, gap: number): number {
  return (side === "top" || side === "bottom" ? card.height : card.width) + gap;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** Sides to try, best first: the preferred one, its opposite, then whichever has most room. */
export function sideOrder(preferred: Side | "auto" | undefined, space: Record<Side, number>): Side[] {
  const all: Side[] = ["bottom", "top", "right", "left"];
  const byRoom = [...all].sort((a, b) => space[b] - space[a] || all.indexOf(a) - all.indexOf(b));
  if (!preferred || preferred === "auto") return all;
  return [preferred, OPPOSITE[preferred], ...byRoom.filter((s) => s !== preferred && s !== OPPOSITE[preferred])];
}

export function computePlacement(input: PlacementInput): Placement {
  const { target, card, viewport, preferred = "auto", gap = 16, margin = 16, arrowInset = 18 } = input;
  const space = spaceAround(target, viewport, margin);
  const order = sideOrder(preferred, space);
  const side = order.find((s) => space[s] >= needed(s, card, gap));
  const fits = side !== undefined;
  // Nothing fits: take the side with the most room so the caller still has a sane position.
  const chosen: Side = side ?? (["bottom", "top", "right", "left"] as Side[]).reduce((best, s) => (space[s] > space[best] ? s : best), "bottom");

  let top: number;
  let left: number;
  if (chosen === "bottom" || chosen === "top") {
    top = chosen === "bottom" ? target.top + target.height + gap : target.top - gap - card.height;
    left = clamp(target.left + target.width / 2 - card.width / 2, margin, viewport.width - card.width - margin);
  } else {
    left = chosen === "right" ? target.left + target.width + gap : target.left - gap - card.width;
    top = clamp(target.top + target.height / 2 - card.height / 2, margin, viewport.height - card.height - margin);
  }
  const vertical = chosen === "bottom" || chosen === "top";
  const centre = vertical ? target.left + target.width / 2 - left : target.top + target.height / 2 - top;
  const length = vertical ? card.width : card.height;
  return { side: chosen, top, left, arrowOffset: clamp(centre, arrowInset, length - arrowInset), fits };
}

/** The part of `box` that is inside `clip` (a scrolled panel's visible area), or null when none is. */
export function intersectBox(box: Box, clip: Box): Box | null {
  const top = Math.max(box.top, clip.top);
  const left = Math.max(box.left, clip.left);
  const bottom = Math.min(box.top + box.height, clip.top + clip.height);
  const right = Math.min(box.left + box.width, clip.left + clip.width);
  if (bottom <= top || right <= left) return null;
  return { top, left, width: right - left, height: bottom - top };
}

export function padBox(box: Box, pad: number): Box {
  return { top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
}

export const SHEET_MAX_WIDTH = 640;
export function usesSheet(viewportWidth: number): boolean {
  return viewportWidth <= SHEET_MAX_WIDTH;
}

/** How far to scroll (positive = down) so the target sits in the free area above a bottom sheet. 0 = already fine. */
export function scrollDeltaForSheet(target: Box, viewportHeight: number, sheetHeight: number, margin = 16): number {
  const visibleBottom = viewportHeight - sheetHeight - margin;
  if (target.height > visibleBottom - margin) return target.top - margin; // too tall: show its top
  if (target.top < margin) return target.top - margin;
  if (target.top + target.height > visibleBottom) return target.top + target.height - visibleBottom;
  return 0;
}

/** Whether a target is comfortably on screen (so we don't scroll needlessly). */
export function isInView(target: Box, viewport: Size, margin = 80): boolean {
  return target.top >= margin && target.top + target.height <= viewport.height - margin;
}
