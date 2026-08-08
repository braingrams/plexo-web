"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Ported from plexo-sdk's InlineColorPicker (src/components/inlineControls/InlineColorPicker.tsx)
 * — same hex/rgba parsing, HSV<->hex math, and pointer-driven saturation/hue canvases, since
 * that's all plain DOM/React with no external color library. Dropped: the label + its own hex
 * text input (the swatch card around this component already has one) and StrataTokenPicker
 * (a design-token picker wired to plexo-sdk's own Zustand store — not available here). Also
 * switched from an inline `absolute`-positioned panel to a portal + fixed positioning, since
 * this trigger lives inside the Text Content tab's scrollable fields column — an inline
 * absolute panel would get clipped by that ancestor's overflow:auto.
 */

type Props = {
  value: string;
  onChange: (value: string) => void;
};

function parseColorAndOpacity(colorStr: string) {
  let hex = "#ffffff";
  let opacity = 100;

  const trimmed = (colorStr || "").trim().toLowerCase();
  if (trimmed.startsWith("#")) {
    if (trimmed.length === 9) {
      hex = colorStr.slice(0, 7);
      const alpha = parseInt(colorStr.slice(7, 9), 16);
      opacity = isNaN(alpha) ? 100 : Math.round((alpha / 255) * 100);
    } else if (trimmed.length === 5) {
      const r = colorStr[1];
      const g = colorStr[2];
      const b = colorStr[3];
      const a = colorStr[4];
      hex = `#${r}${r}${g}${g}${b}${b}`;
      const alpha = parseInt(a, 16);
      opacity = isNaN(alpha) ? 100 : Math.round((alpha / 15) * 100);
    } else {
      hex = colorStr;
      opacity = 100;
    }
  } else if (trimmed.startsWith("rgba") || trimmed.startsWith("rgb")) {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(trimmed);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, "0");
      const g = parseInt(match[2]).toString(16).padStart(2, "0");
      const b = parseInt(match[3]).toString(16).padStart(2, "0");
      hex = `#${r}${g}${b}`;
      opacity = match[4] !== undefined ? Math.round(parseFloat(match[4]) * 100) : 100;
    }
  } else if (trimmed === "transparent") {
    hex = "#ffffff";
    opacity = 0;
  } else {
    hex = colorStr || "#ffffff";
    opacity = 100;
  }

  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const v = max * 100;
  const d = max - min;
  const s = max === 0 ? 0 : (d / max) * 100;

  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { hex, opacity, h: Math.round(h * 360), s: Math.round(s), v: Math.round(v) };
}

function hsvToHex(h: number, s: number, v: number): string {
  s /= 100;
  v /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => v * (1 - s * Math.max(0, Math.min(k(n) - 3, 9 - k(n), 1)));
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export function ColorSwatchPicker({ value, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const saturationRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const isInteracting = useRef(false);

  const isTransparent = !value || value === "transparent";
  const parsed = parseColorAndOpacity(value);
  const { hex, opacity } = parsed;

  const [internalHSV, setInternalHSV] = useState({ h: parsed.h, s: parsed.s, v: parsed.v });

  useEffect(() => {
    if (!isInteracting.current) setInternalHSV({ h: parsed.h, s: parsed.s, v: parsed.v });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.h, parsed.s, parsed.v]);

  // useLayoutEffect (not useEffect) so this runs BEFORE the browser paints the newly-opened
  // panel — otherwise it renders once at panelPos's stale default, top:0/left:0, and only
  // snaps to the real position a frame later, a visible flash/glitch at the corner of the
  // screen. The click handler below also seeds panelPos synchronously for the same reason,
  // so this effect's first run (on open) is normally just confirming what's already correct.
  useLayoutEffect(() => {
    if (!isOpen) return;
    function reposition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = 224;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - panelWidth - 8);
      setPanelPos({ top: rect.bottom + 6, left });
    }
    reposition();

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    // Closing on scroll (rather than repositioning) matches plexo-sdk's StrataTokenPicker —
    // simplest way to never end up anchored to a trigger that's since scrolled away.
    function handleScroll() {
      setIsOpen(false);
    }
    // Deferred by a tick: attaching this SAME render pass (synchronously, as part of the
    // click that just opened the panel) risks the listener still being live for that very
    // click's own mousedown under React StrictMode's double-effect invocation in dev, or
    // simply from firing before the triggering event has fully finished dispatching —
    // either way it reads as the panel needing two or three clicks before it "sticks" open,
    // since each open immediately self-closes. A zero-delay timeout guarantees this can only
    // ever react to a LATER, genuinely separate interaction.
    const attachTimer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
    }, 0);
    window.addEventListener("resize", reposition);
    return () => {
      clearTimeout(attachTimer);
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen]);

  function updateFinalColor(targetHex: string, targetOpacity: number) {
    if (targetOpacity === 0) onChange("transparent");
    else if (targetOpacity === 100) onChange(targetHex);
    else {
      const alphaHex = Math.round((targetOpacity / 100) * 255).toString(16).padStart(2, "0");
      onChange(`${targetHex}${alphaHex}`);
    }
  }

  function handleOpacityChange(newOpacity: number) {
    if (newOpacity === 100) onChange(hex);
    else if (newOpacity > 0) {
      const alphaHex = Math.round((newOpacity / 100) * 255).toString(16).padStart(2, "0");
      onChange(`${hex}${alphaHex}`);
    }
  }

  function calcSaturationFromPoint(clientX: number, clientY: number) {
    if (!saturationRef.current) return;
    const rect = saturationRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    const next = { ...internalHSV, s: Math.round(x * 100), v: Math.round(y * 100) };
    setInternalHSV(next);
    updateFinalColor(hsvToHex(next.h, next.s, next.v), opacity === 0 ? 100 : opacity);
  }

  function handleSaturationPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (isTransparent || !saturationRef.current) return;
    e.preventDefault();
    isInteracting.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    calcSaturationFromPoint(e.clientX, e.clientY);
  }
  function handleSaturationPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isInteracting.current) return;
    calcSaturationFromPoint(e.clientX, e.clientY);
  }
  function handlePointerUp() {
    isInteracting.current = false;
  }

  function calcHueFromPoint(clientX: number) {
    if (!hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const next = { ...internalHSV, h: Math.round(percent * 360) };
    setInternalHSV(next);
    updateFinalColor(hsvToHex(next.h, next.s, next.v), opacity === 0 ? 100 : opacity);
  }

  function handleHuePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (isTransparent || !hueRef.current) return;
    e.preventDefault();
    isInteracting.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    calcHueFromPoint(e.clientX);
  }
  function handleHuePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isInteracting.current) return;
    calcHueFromPoint(e.clientX);
  }

  async function handleEyeDropper() {
    const EyeDropperClass = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropperClass) return;
    try {
      const result = await new EyeDropperClass().open();
      updateFinalColor(result.sRGBHex, opacity === 0 ? 100 : opacity);
    } catch {
      // User canceled the pick — nothing to do.
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!isOpen) {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) {
              const panelWidth = 224;
              const left = Math.min(Math.max(8, rect.left), window.innerWidth - panelWidth - 8);
              setPanelPos({ top: rect.bottom + 6, left });
            }
          }
          setIsOpen((v) => !v);
        }}
        title="Pick a color"
        style={{
          position: "relative", width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          overflow: "hidden", border: isOpen ? "1px solid #8b5cf6" : "1px solid rgba(255,255,255,0.15)",
          cursor: "pointer", padding: 0,
          backgroundImage:
            "linear-gradient(45deg, rgba(255,255,255,0.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.12) 75%)",
          backgroundSize: "8px 8px",
          backgroundColor: "#1e1b30",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: isTransparent ? "transparent" : value, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isTransparent && <div style={{ position: "absolute", width: "140%", height: 2, background: "#f87171", transform: "rotate(45deg)" }} />}
        </div>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed", top: panelPos.top, left: panelPos.left, zIndex: 100000,
              width: 224, borderRadius: 12, padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem",
              background: "#16142c", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              color: "#f0f2ff",
            }}
          >
            <div
              ref={saturationRef}
              onPointerDown={handleSaturationPointerDown}
              onPointerMove={handleSaturationPointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                height: 112, width: "100%", borderRadius: 8, position: "relative", overflow: "hidden",
                cursor: "crosshair", userSelect: "none", touchAction: "none",
                background: `hsl(${internalHSV.h}, 100%, 50%)`,
                opacity: isTransparent ? 0.25 : 1, pointerEvents: isTransparent ? "none" : "auto",
              }}
            >
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, #fff, transparent)" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, #000, transparent)" }} />
              <div
                style={{
                  position: "absolute", width: 12, height: 12, border: "2px solid #fff", borderRadius: "50%",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.5)", pointerEvents: "none",
                  left: `${internalHSV.s}%`, bottom: `${internalHSV.v}%`, transform: "translate(-50%, 50%)",
                }}
              />
            </div>

            <div
              ref={hueRef}
              onPointerDown={handleHuePointerDown}
              onPointerMove={handleHuePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                position: "relative", width: "100%", height: 10, borderRadius: 999, cursor: "pointer",
                userSelect: "none", touchAction: "none",
                background: "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
                opacity: isTransparent ? 0.25 : 1, pointerEvents: isTransparent ? "none" : "auto",
              }}
            >
              <div
                style={{
                  position: "absolute", top: "50%", width: 12, height: 12, background: "#fff",
                  border: "1px solid rgba(0,0,0,0.3)", borderRadius: "50%", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  pointerEvents: "none", left: `${(internalHSV.h / 360) * 100}%`, transform: "translate(-50%, -50%)",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(240,242,255,0.6)" }}>Opacity</span>
                <span style={{ fontSize: "0.65rem", fontFamily: "monospace", background: "rgba(255,255,255,0.06)", padding: "0.1rem 0.35rem", borderRadius: 5, color: "rgba(240,242,255,0.6)" }}>
                  {opacity}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={opacity}
                disabled={isTransparent}
                onChange={(e) => handleOpacityChange(parseInt(e.target.value, 10))}
                style={{ width: "100%", accentColor: "#8b5cf6" }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.5rem" }}>
              <button
                type="button"
                onClick={() => void handleEyeDropper()}
                title="Pick color from screen"
                style={{
                  display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 7,
                  border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
                  color: "rgba(240,242,255,0.7)", cursor: "pointer",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 2 5.5 15.5" />
                  <path d="M15 6 6.5 14.5" />
                  <path d="m11 4 9 9" />
                  <path d="m3 16 1.5 1.5L3 21l3.5-1.5L8 21l8-8" />
                </svg>
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 600, color: "rgba(240,242,255,0.6)" }}>Transparent</span>
                <button
                  type="button"
                  onClick={() => onChange(isTransparent ? hex : "transparent")}
                  style={{
                    position: "relative", width: 30, height: 17, borderRadius: 999, border: "none", flexShrink: 0,
                    cursor: "pointer", background: isTransparent ? "#8b5cf6" : "rgba(255,255,255,0.15)",
                  }}
                >
                  <span
                    style={{
                      position: "absolute", top: 2, left: isTransparent ? 15 : 2, width: 13, height: 13,
                      borderRadius: "50%", background: "#fff", transition: "left 0.15s",
                    }}
                  />
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
