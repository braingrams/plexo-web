"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "./cx";

/**
 * A row (of tabs) that can be wider than the screen, and clearly says so: a round arrow button on the
 * side that has more, a soft fade only on that side, the mouse wheel / a drag / a swipe moves it, the
 * chosen tab is brought into view, and tabbing to a hidden tab brings it into view too.
 * `activeKey` is anything that changes when the chosen tab changes.
 */
export function ScrollRail({ children, className, activeKey, label = "Tabs" }: { children: React.ReactNode; className?: string; activeKey?: string; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);

  const smooth = () => (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  const by = (dir: 1 | -1) => {
    const el = box.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: smooth() });
  };

  // Keep the measurement fresh as the row or its tabs change size.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    return () => ro?.disconnect();
  }, [measure, children]);

  // The chosen tab, centred, on load and whenever it changes.
  useEffect(() => {
    const el = box.current;
    const tab = el?.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]');
    if (el && tab && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2);
    measure();
  }, [activeKey, measure]);

  // The mouse wheel / trackpad scrolls the row sideways, and a mouse can drag it.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
      if (atStart || atEnd) return; // let the page scroll when the row can't
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    let down: { x: number; left: number } | null = null;
    let dragged = false;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = { x: e.clientX, left: el.scrollLeft };
      dragged = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (!dragged && Math.abs(dx) > 5) {
        dragged = true;
        el.setAttribute("data-drag", "true");
      }
      if (dragged) el.scrollLeft = down.left - dx;
    };
    const onUp = () => {
      down = null;
      el.removeAttribute("data-drag");
    };
    // A drag that ends on a tab must not open it.
    const onClick = (e: MouseEvent) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("click", onClick, true);
    };
  }, []);

  // Tabbing to a tab that is cut off brings it into view.
  const onFocus = (e: React.FocusEvent) => {
    const el = box.current;
    const t = e.target as HTMLElement;
    if (!el || !t || t === el) return;
    const pad = 56;
    if (t.offsetLeft - pad < el.scrollLeft) el.scrollTo({ left: Math.max(0, t.offsetLeft - pad), behavior: smooth() });
    else if (t.offsetLeft + t.offsetWidth + pad > el.scrollLeft + el.clientWidth) el.scrollTo({ left: t.offsetLeft + t.offsetWidth + pad - el.clientWidth, behavior: smooth() });
  };

  return (
    <div className="plx-rail" data-left={more.left} data-right={more.right}>
      {more.left ? (
        <button type="button" className="plx-rail__btn plx-rail__btn--l" aria-label="Scroll tabs left" onClick={() => by(-1)}>
          <ChevronLeft size={20} aria-hidden />
        </button>
      ) : null}
      <div ref={box} className={cx("plx-rail__scroll", className)} onScroll={measure} onFocusCapture={onFocus} role="group" aria-label={label}>
        {children}
      </div>
      {more.right ? (
        <button type="button" className="plx-rail__btn plx-rail__btn--r" aria-label="Scroll tabs right" onClick={() => by(1)}>
          <ChevronRight size={20} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
