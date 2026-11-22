"use client";

import "./allsites.css";
import { useEffect, useRef, useState } from "react";

const SHOT_W = 1280;

/** A real picture of the site (its working copy, small and not clickable) over the site's colour. Loads as it scrolls into view. */
export function Shot({ id, colour }: { id: string; colour: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => setScale(el.clientWidth / SHOT_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="plx-ab__shot" ref={box} aria-hidden>
      <div className="plx-ab__shotbar"><i /><i /><i /></div>
      <iframe src={`/api/v1/templates/${id}/draft-preview?thumb=1`} title="" tabIndex={-1} loading="lazy" referrerPolicy="no-referrer" style={{ width: SHOT_W, height: Math.round((SHOT_W * 10) / 16), transform: `scale(${scale})`, background: colour }} />
    </div>
  );
}
