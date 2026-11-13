"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

// Shown once a server app is live. Any part of the dashboard can open it by calling announceAppLive, so it
// stays on screen after the modal that started the build has closed. It's rendered into document.body, so no
// parent's transform, overflow or opacity can make its backdrop see-through.
// Colours come from the theme variables (lib/theme.ts), so they follow Strata's settings.
export function AppLiveDialog() {
  const [live, setLive] = useState<AppLiveDetail | null>(null);

  useEffect(() => {
    const onLive = (event: Event) => setLive((event as CustomEvent<AppLiveDetail>).detail);
    window.addEventListener(APP_LIVE_EVENT, onLive);
    return () => window.removeEventListener(APP_LIVE_EVENT, onLive);
  }, []);

  useEffect(() => {
    if (!live) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live]);

  if (!live || typeof document === "undefined") return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="app-live-title" style={backdropStyle} onClick={() => setLive(null)}>
      <div style={panelStyle} onClick={(event) => event.stopPropagation()}>
        <h2 id="app-live-title" style={headingStyle}>
          Your app is live
        </h2>
        <p style={bodyStyle}>It&apos;s running at its own address now. Manage its builds, domains and settings from the app&apos;s page.</p>
        <div style={actionsStyle}>
          <a href={live.liveUrl} target="_blank" rel="noopener noreferrer" style={primaryButtonStyle}>
            Open site
          </a>
          <Link href={live.detailUrl} onClick={() => setLive(null)} style={secondaryButtonStyle}>
            Open app details
          </Link>
        </div>
        <button type="button" onClick={() => setLive(null)} aria-label="Close" style={closeButtonStyle}>
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}

export const APP_LIVE_EVENT = "plexo:app-live";

export type AppLiveDetail = { liveUrl: string; detailUrl: string };

export function announceAppLive(detail: AppLiveDetail): void {
  window.dispatchEvent(new CustomEvent<AppLiveDetail>(APP_LIVE_EVENT, { detail }));
}

// The backdrop is the page colour at 78% opacity, taken from the theme's background variable.
const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--bg) 78%, transparent)",
  backdropFilter: "blur(3px)",
  padding: 20,
};

const panelStyle: CSSProperties = {
  position: "relative",
  width: "min(440px, 100%)",
  borderRadius: 14,
  border: "1px solid var(--surface-border)",
  background: "var(--surface)",
  boxShadow: "var(--shadow-card)",
  padding: "26px 28px",
};

const headingStyle: CSSProperties = { margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: "var(--text-main)" };

const bodyStyle: CSSProperties = { margin: "0 0 20px", fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)" };

const actionsStyle: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };

const buttonBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "9px 16px",
  borderRadius: 9,
  fontWeight: 650,
  fontSize: 13,
  textDecoration: "none",
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = { ...buttonBase, background: "var(--brand)", color: "#fff", border: "none" };

const secondaryButtonStyle: CSSProperties = {
  ...buttonBase,
  background: "transparent",
  color: "var(--text-main)",
  border: "1px solid var(--surface-border)",
};

const closeButtonStyle: CSSProperties = {
  position: "absolute",
  top: 10,
  right: 12,
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 22,
  lineHeight: 1,
  cursor: "pointer",
};
