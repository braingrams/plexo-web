"use client";

import { useEffect, useState } from "react";
import { useLayoutMode, type LayoutMode } from "../layout-mode-context";

function IconSwap() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

const OTHER_MODE: Record<LayoutMode, LayoutMode> = {
  MODERN: "CLASSIC",
  CLASSIC: "MODERN",
};

const MODE_LABEL: Record<LayoutMode, string> = {
  MODERN: "Modern",
  CLASSIC: "Classic",
};

const DISMISSED_KEY = "plexo-layout-banner-dismissed";

/** Small strip banner that lets the user flip between Modern/Classic dashboard layouts in one click. */
export function LayoutSwitchBanner() {
  const { mode, setMode, saving } = useLayoutMode();
  const [stage, setStage] = useState<"loading" | "visible" | "dismissed" | "hidden">("loading");

  useEffect(() => {
    setStage(localStorage.getItem(DISMISSED_KEY) ? "hidden" : "visible");
  }, []);

  useEffect(() => {
    if (stage !== "dismissed") return;
    const timer = setTimeout(() => setStage("hidden"), 5000);
    return () => clearTimeout(timer);
  }, [stage]);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setStage("dismissed");
  }

  if (stage === "loading" || stage === "hidden") return null;

  if (stage === "dismissed") {
    return (
      <p className="text-center"
        style={{
          margin: "0 0 1.25rem",
          fontSize: "0.85rem",
          color: "var(--text-muted)",
        }}
      >
        You can always switch layouts again from the Profile tab.
      </p>
    );
  }

  const target = OTHER_MODE[mode];

  return (
    <div
      className="flex flex-row flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 sm:gap-3"
      style={{
        padding: "0.55rem 0.85rem",
        marginBottom: "1.25rem",
        borderRadius: 10,
        background: "var(--brand-subtle)",
        border: "1px solid var(--brand-glow)",
        fontSize: "0.8rem",
        color: "var(--text-main)",
      }}
      role="status"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-muted)", flex: "1 1 180px" }}>
        <span style={{ display: "inline-flex", flexShrink: 0 }}>
          <IconSwap />
        </span>
        <span style={{ fontSize: "0.78rem", lineHeight: 1.35 }}>
          You&apos;re using the <strong style={{ color: "var(--text-main)" }}>{MODE_LABEL[mode]}</strong> layout.
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0, marginLeft: "auto" }}>
        <button
          onClick={() => void setMode(target)}
          disabled={saving}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.35rem 0.75rem",
            borderRadius: 999,
            border: "none",
            background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
            color: "#fff",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {saving ? "Switching…" : `Switch to ${MODE_LABEL[target]}`}
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            fontSize: "0.95rem",
            lineHeight: 1,
            padding: "0.25rem",
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
