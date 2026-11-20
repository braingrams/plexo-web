"use client";

import { pageZoom } from "@/lib/dashboardV3/pageZoom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Portal } from "./portal";
import { cx } from "./cx";

/**
 * A panel that opens above the page (in the overlay layer, never inline), next to the button that
 * opened it. On phones it is a full-width sheet from the bottom. Esc or a tap outside closes it.
 */
export function FloatingPanel({
  open,
  onClose,
  anchorRef,
  width = 360,
  label,
  className,
  tourId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  width?: number;
  label: string;
  className?: string;
  /** Lets the product tour point at this panel (data-tour). */
  tourId?: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      // The browser measures in what you see; the panel is placed in the dashboard's own units (see pageZoom).
      const z = pageZoom(anchorRef.current);
      const r = anchorRef.current?.getBoundingClientRect();
      const vw = window.innerWidth / z;
      const w = Math.min(width, vw - 24);
      if (!r) return setPos({ left: 12, top: 72, width: w });
      const left = Math.max(12, Math.min(r.left / z, vw - w - 12));
      setPos({ left, top: r.bottom / z + 8, width: w });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchorRef, width]);

  useEffect(() => {
    if (!open) return;
    const trigger = anchorRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        trigger?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || trigger?.contains(t)) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, anchorRef]);

  if (!open) return null;
  return (
    <Portal>
      <div className="plx-pop-backdrop" aria-hidden onClick={() => onCloseRef.current()} />
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        data-tour={tourId}
        className={cx("plx-pop", className)}
        style={pos ? ({ left: pos.left, top: pos.top, width: pos.width, "--plx-pop-top": `${pos.top}px` } as React.CSSProperties) : { visibility: "hidden" }}
      >
        {children}
      </div>
    </Portal>
  );
}
