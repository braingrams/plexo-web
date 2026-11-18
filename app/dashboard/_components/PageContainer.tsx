"use client";

import { createContext, useContext, CSSProperties } from "react";

type Props = {
  children: React.ReactNode;
  style?: CSSProperties;
  className?: string;
};

const EmbeddedCtx = createContext(false);

/** Wrap an old full-page screen in this to show it inside another page (the hub's Advanced area): no page padding of its own. */
export function EmbeddedScreen({ children }: { children: React.ReactNode }) {
  return <EmbeddedCtx.Provider value>{children}</EmbeddedCtx.Provider>;
}

/** True when the screen is shown inside another page, so it can leave out its own back link. */
export function useEmbeddedScreen(): boolean {
  return useContext(EmbeddedCtx);
}

/** The one top-level wrapper every dashboard page body should render inside — every page
 * gets the same fixed 1920px column and padding, full width up to that cap, no per-page
 * narrower variants. Keeps pages consistent instead of each one hand-rolling its own
 * (which had drifted: different padding shorthands and different max-widths per page). */
export function PageContainer({ children, style, className }: Props) {
  const embedded = useContext(EmbeddedCtx);
  return (
    <div className={className} style={{ padding: "2rem 32px", maxWidth: 1920, width: "100%", margin: "0 auto", ...style, ...(embedded ? { padding: 0, maxWidth: "none", margin: 0 } : {}) }}>
      {children}
    </div>
  );
}
