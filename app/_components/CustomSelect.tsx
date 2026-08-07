"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function IconChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * The one dropdown every page should use instead of a native <select> — the native popup
 * is drawn by the OS/browser using its own light/dark heuristic, not this app's CSS or
 * theme, so it can pop open unreadable (e.g. near-white text on a white background)
 * regardless of this page's own color-scheme. Rendering the option list ourselves
 * guarantees it always matches the app's actual theme, in both the dashboard (fixed dark)
 * and theme-aware public pages (light/dark via the var(--...) tokens in app/globals.css) —
 * every color here is one of those tokens, not a hardcoded value, specifically so this
 * single component is safe to reuse on both.
 */
export function CustomSelect({
  value,
  options,
  disabled,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  options: Array<{ label: string; value: string; disabled?: boolean }>;
  disabled?: boolean;
  onChange: (val: string) => void;
  /** Shown when value doesn't match any option (e.g. no selection yet) — falls back to the raw value. */
  placeholder?: string;
  /** Applied to the trigger button, for callers that need a different size/shape than the default. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);

  // Positions the menu (portaled to document.body below) from the trigger's live viewport
  // coordinates instead of a CSS-relative offset — a plain position:absolute gets silently
  // clipped by any scrollable ancestor (e.g. a table's horizontal-scroll wrapper: setting
  // overflowX without overflowY makes the browser compute overflowY as "auto" too per the
  // CSS overflow spec, turning that wrapper into a vertical clipping box). A portal escapes
  // that ancestor entirely, and the flip direction is decided from actual available space.
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuHeight = Math.min(320, options.length * 40 + 16);
    const spaceBelow = window.innerHeight - rect.bottom;
    const shouldOpenUpwards = spaceBelow < menuHeight + 12 && rect.top > spaceBelow;
    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      ...(shouldOpenUpwards
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    // Capture-phase scroll listener so this also repositions on scroll from any
    // scrollable ancestor, not just the window.
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={className}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          padding: "0.6rem 0.875rem",
          borderRadius: 9,
          border: open ? "1px solid var(--brand)" : "1px solid var(--surface-border)",
          background: open ? "var(--brand-subtle)" : "var(--surface)",
          color: disabled ? "var(--text-faint)" : "var(--text-main)",
          fontFamily: "inherit",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "border-color 0.15s, background 0.15s",
          boxShadow: open ? "0 0 0 2px var(--brand-glow)" : "none",
        }}
      >
        <span>{selected?.label ?? placeholder ?? value}</span>
        <span style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-flex", flexShrink: 0 }}>
          <IconChevronDown />
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          {/* Backdrop — above any other fixed-position overlay in the app, since this is
              portaled to document.body (a stacking-order sibling of whatever it opened
              from, not nested inside it) and needs to out-rank it or render invisibly behind it. */}
          <div style={{ position: "fixed", inset: 0, zIndex: 10100 }} onClick={() => setOpen(false)} />
          {/* Dropdown panel */}
          <div
            style={{
              ...menuStyle,
              zIndex: 10101,
              background: "var(--bg-2)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid var(--brand)",
              borderRadius: 10,
              maxHeight: "min(320px, 60vh)",
              overflowY: "auto",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35), 0 0 0 1px var(--brand-glow)",
            }}
          >
            {options.map((opt) => {
              const isActive = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => { if (opt.disabled) return; onChange(opt.value); setOpen(false); }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.625rem 0.875rem",
                    background: isActive ? "var(--brand-subtle)" : "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--surface-border)",
                    color: opt.disabled ? "var(--text-faint)" : isActive ? "var(--brand)" : "var(--text-muted)",
                    fontFamily: "inherit",
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 400,
                    cursor: opt.disabled ? "not-allowed" : "pointer",
                    textAlign: "left",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  <span>{opt.label}</span>
                  {isActive && <span style={{ color: "var(--brand)", display: "flex", alignItems: "center" }}><IconCheck /></span>}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
