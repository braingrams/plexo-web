"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { pageZoom } from "@/lib/dashboardV3/pageZoom";
import { stepAnchors, type ResolvedTourStep } from "@/lib/dashboardV3/tour";
import { computePlacement, intersectBox, isInView, padBox, scrollDeltaForSheet, usesSheet, type Box, type Placement } from "@/lib/dashboardV3/tourPlacement";
import { SolMascot } from "../sol/SolMascot";
import { Button } from "../ui/Button";
import { Portal, trapTab } from "../ui/portal";

const PAD = 8;
const GAP = 18;
const WAIT_FOR_ANCHOR_MS = 3500;

/** The first on-screen element carrying this anchor (a phone and a desktop copy can both exist; only one is shown). */
export function visibleAnchor(anchor: string, root: ParentNode = document): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(anchor)}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

/** Scrolling panels around an element: what is visible of it is only the part inside each of them. */
function clipBoxes(el: HTMLElement): Box[] {
  const out: Box[] = [];
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(o.overflowX + o.overflowY)) {
      const r = p.getBoundingClientRect();
      out.push({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
  }
  return out;
}

/** The target's box in what you SEE, narrowed to what its scrolling panels actually show. null = scrolled out of sight. */
export function measureTarget(el: HTMLElement): Box | null {
  const r = el.getBoundingClientRect();
  let box: Box | null = { top: r.top, left: r.left, width: r.width, height: r.height };
  for (const clip of clipBoxes(el)) {
    box = box && intersectBox(box, clip);
    if (!box) return null;
  }
  return box;
}

const sameBox = (a: Box | null, b: Box | null) => (a === b) || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
const sameBoxes = (a: (Box | null)[], b: (Box | null)[]) => a.length === b.length && a.every((x, i) => sameBox(x, b[i]));

/** Still laid out on screen (a phone and a desktop copy of an anchor can both exist; the hidden one has no size). */
function isShown(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

type Props = {
  step: ResolvedTourStep;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onPause: () => void;
  onMissing: () => void;
};

/**
 * One step: dims the page, rings the exact element, and puts the card beside it with an arrow
 * that points at it. It follows the element through scrolls, resizes and layout shifts, keeps the
 * card off the element, and on a phone becomes a bottom sheet with the element scrolled into view above it.
 */
export function CoachMark({ step, index, total, onNext, onBack, onSkip, onPause, onMissing }: Props) {
  // One ring per anchor that is on screen right now (the first is where the card sits). A step can point at several things at once.
  const [rects, setRects] = useState<Box[]>([]);
  const rect = rects[0] ?? null;
  const maskId = `plx-tour-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const anchors = stepAnchors(step);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [sheet, setSheet] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const targets = useRef<(HTMLElement | null)[]>([]);
  const cardSize = useRef({ width: 0, height: 0 });
  const [cardTick, setCardTick] = useState(0);
  const last = index === total - 1;

  // Find the anchor (it may still be rendering after a page change), then follow it every frame it moves.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lastSeen = 0;
    let lastBoxes: (Box | null)[] = [];
    let lastPrimary: HTMLElement | null = null;
    const startedAt = Date.now();
    let scrolled = false;

    const bring = (el: HTMLElement) => {
      const phone = usesSheet(window.innerWidth);
      const r = el.getBoundingClientRect();
      const z = pageZoom(el);
      const box = { top: r.top, left: r.left, width: r.width, height: r.height };
      if (phone) {
        const sheetH = (cardSize.current.height || 240) * z;
        const dy = scrollDeltaForSheet(box, window.innerHeight, sheetH + 16);
        if (dy) el.scrollIntoView({ block: "nearest", behavior: "auto" });
        const r2 = el.getBoundingClientRect();
        const dy2 = scrollDeltaForSheet({ top: r2.top, left: r2.left, width: r2.width, height: r2.height }, window.innerHeight, sheetH + 16);
        if (dy2) window.scrollBy({ top: dy2, behavior: "auto" });
      } else if (!isInView(box, { width: window.innerWidth, height: window.innerHeight }) || !measureTarget(el)) {
        el.scrollIntoView({ block: "center", behavior: "auto" });
      }
    };

    const tick = () => {
      if (cancelled) return;
      if (step.desktopOnly && usesSheet(window.innerWidth)) {
        onMissing();
        return;
      }
      // Every anchor of the step that is on screen right now. Hidden ones (the other layout's copy) are simply not there: never waited for.
      let found: HTMLElement[] = [];
      anchors.forEach((name, i) => {
        let el = targets.current[i] ?? null;
        if (!el || !isShown(el)) el = targets.current[i] = visibleAnchor(name);
        if (el) found.push(el);
      });
      // On a phone the card is a sheet over the bottom of the screen: a ring under it (the bottom bar) would be hidden, so leave it out.
      if (found.length > 1 && usesSheet(window.innerWidth)) {
        const limit = window.innerHeight - ((cardSize.current.height || 240) * pageZoom(found[0]) + 16);
        const clear = found.filter((el) => el.getBoundingClientRect().bottom <= limit);
        if (clear.length) found = clear;
      }
      if (found.length) {
        lastSeen = Date.now();
        const primary = found[0];
        if (primary !== lastPrimary) {
          lastPrimary = primary;
          scrolled = false;
        }
        if (!scrolled) {
          scrolled = true;
          bring(primary);
        }
        const boxes = found.map((el) => measureTarget(el));
        if (!sameBoxes(boxes, lastBoxes)) {
          lastBoxes = boxes;
          const shown = found.flatMap((el, i) => {
            const box = boxes[i];
            if (!box) return [];
            const z = pageZoom(el); // measured in what you see, placed in the dashboard's own units
            return [padBox({ top: box.top / z, left: box.left / z, width: box.width / z, height: box.height / z }, PAD)];
          });
          if (shown.length) setRects(shown);
          // The first one scrolled out of its own panel: bring it back rather than pointing at nothing.
          if (!boxes[0]) scrolled = false;
        }
      } else if (Date.now() - (lastSeen || startedAt) > WAIT_FOR_ANCHOR_MS) {
        onMissing();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // onMissing is stable enough per step (keyed by step id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, anchors.join("|")]);

  // The card's own size (it changes with text length and screen width).
  useEffect(() => {
    const el = card.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const z = pageZoom(el);
      const r = el.getBoundingClientRect();
      const next = { width: r.width / z, height: r.height / z };
      if (next.width !== cardSize.current.width || next.height !== cardSize.current.height) {
        cardSize.current = next;
        setCardTick((t) => t + 1);
      }
    });
    ro.observe(el);
    const onResize = () => setCardTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Put the card beside the ring without covering it, with an arrow toward it.
  useLayoutEffect(() => {
    if (!rect || !card.current) return;
    const z = pageZoom(card.current);
    const cr = card.current.getBoundingClientRect();
    const size = { width: cr.width / z, height: cr.height / z };
    cardSize.current = size;
    const viewport = { width: window.innerWidth / z, height: window.innerHeight / z };
    const phone = usesSheet(window.innerWidth);
    setSheet(phone);
    if (phone) return setPlacement(null);
    const p = computePlacement({ target: rect, card: size, viewport, preferred: step.placement, gap: GAP });
    // No side has room (a very large target): sit over the part of the screen the target leaves free.
    setPlacement(p);
  }, [rect, cardTick, step.placement]);

  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, [step.id]);

  const onKey = (e: React.KeyboardEvent) => {
    if (trapTab(e, card.current)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onPause();
    } else if (e.key === "ArrowRight") onNext();
    else if (e.key === "ArrowLeft" && index > 0) onBack();
  };

  const ready = !!rect && (sheet || !!placement);
  const arrowStyle: React.CSSProperties | undefined = placement
    ? placement.side === "bottom" || placement.side === "top"
      ? { left: placement.arrowOffset }
      : { top: placement.arrowOffset }
    : undefined;

  return (
    <Portal>
      <div className="plx-tour-shield" aria-hidden onClick={(e) => e.stopPropagation()} />
      {rects.length > 1 ? (
        // Several things lit at once: one dim layer with a hole for each (stacked shadows would dim one ring through another).
        <svg className="plx-tour-dim" aria-hidden>
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              {rects.map((r, i) => (
                <rect key={i} x={r.left} y={r.top} width={r.width} height={r.height} rx={14} fill="black" />
              ))}
            </mask>
          </defs>
          <rect width="100%" height="100%" mask={`url(#${maskId})`} style={{ fill: "var(--plx-spotlight)" }} />
        </svg>
      ) : null}
      {rects.map((r, i) => (
        <div key={i} className={`plx-tour-spot${rects.length > 1 ? " plx-tour-spot--multi" : ""}`} style={{ top: r.top, left: r.left, width: r.width, height: r.height }} aria-hidden />
      ))}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`tour-${step.id}-title`}
        aria-describedby={`tour-${step.id}-body`}
        tabIndex={-1}
        className={`plx-tour-card${sheet ? " plx-tour-card--sheet" : ""}`}
        data-side={sheet ? undefined : placement?.side}
        style={sheet ? { visibility: ready ? "visible" : "hidden" } : { top: placement?.top ?? -9999, left: placement?.left ?? -9999, visibility: ready ? "visible" : "hidden" }}
        onKeyDown={onKey}
      >
        {placement && !sheet ? <span className="plx-tour-arrow" data-side={placement.side} style={arrowStyle} aria-hidden /> : null}
        <div className="plx-tour-card__top">
          <span className="plx-tour-card__step">
            {index + 1} of {total}
          </span>
          <button type="button" className="plx-tour-card__skip" onClick={onSkip}>
            Skip tour
          </button>
        </div>
        <div className={step.mascot === "sol" ? "plx-tour-card__head plx-tour-card__head--mascot" : "plx-tour-card__head"}>
          {step.mascot === "sol" ? (
            <span className="plx-tour-mascot" aria-hidden>
              <SolMascot size={84} waving />
            </span>
          ) : null}
          <h2 id={`tour-${step.id}-title`} className="plx-tour-card__title">
            {step.title}
          </h2>
        </div>
        <p id={`tour-${step.id}-body`} className="plx-tour-card__body">
          {step.body}
        </p>
        <div className="plx-tour-card__foot">
          <div className="plx-tour-dots" aria-hidden>
            {Array.from({ length: Math.min(total, 24) }, (_, i) => (
              <span key={i} data-on={i === index} data-done={i < index} />
            ))}
          </div>
          <div className="plx-tour-card__btns">
            {index > 0 ? (
              <Button variant="secondary" size="sm" onClick={onBack}>
                Back
              </Button>
            ) : null}
            <Button size="sm" onClick={onNext}>
              {last ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
