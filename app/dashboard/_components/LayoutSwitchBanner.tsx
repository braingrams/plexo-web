"use client";

import { useEffect, useState } from "react";
import { useLayoutMode, type LayoutMode } from "../layout-mode-context";

const OTHER_MODE: Record<LayoutMode, LayoutMode> = {
  MODERN: "CLASSIC",
  CLASSIC: "MODERN",
};

const MODE_LABEL: Record<LayoutMode, string> = {
  MODERN: "Modern",
  CLASSIC: "Classic",
};

const DISMISSED_KEY = "plexo-layout-banner-dismissed";

/** A tiny, low-key text link for flipping Modern/Classic — deliberately unobtrusive rather
 * than a banner competing with page content. The full, deliberate picker with previews lives
 * on the Profile page (LayoutModeSection); this is just a quiet "psst, there's another option"
 * hint, dismissible for good. */
export function LayoutSwitchBanner() {
  const { mode, setMode, saving } = useLayoutMode();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(!!localStorage.getItem(DISMISSED_KEY));
  }, []);

  if (dismissed) return null;

  const target = OTHER_MODE[mode];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.4rem", marginBottom: "0.6rem" }}>
      <button
        onClick={() => void setMode(target)}
        disabled={saving}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          textDecoration: "underline",
          textUnderlineOffset: 2,
          cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 0.75,
        }}
      >
        {saving ? "Switching…" : `Try the ${MODE_LABEL[target]} layout`}
      </button>
      <button
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, "1");
          setDismissed(true);
        }}
        aria-label="Dismiss"
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.7rem", lineHeight: 1, padding: 0, opacity: 0.5 }}
      >
        ×
      </button>
    </div>
  );
}
