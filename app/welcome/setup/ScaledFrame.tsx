"use client";

import { useEffect, useRef, useState } from "react";

/** A finished page shown small: rendered at desktop width, shrunk to fit its box. No scripts run in it, and it can't be clicked. */
export function ScaledFrame({ html, title, width = 1280, aspect = "16 / 11" }: { html: string | null; title: string; width?: number; aspect?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} className="ob-frame" style={{ ["--ob-aspect" as string]: aspect }}>
      {html ? (
        <iframe title={title} srcDoc={html} sandbox="" tabIndex={-1} style={{ width, height: `${100 / scale}%`, transform: `scale(${scale})` }} />
      ) : (
        <div className="ob-frame__loading">Getting your design ready…</div>
      )}
    </div>
  );
}
