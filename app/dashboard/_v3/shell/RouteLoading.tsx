"use client";

import { OptimisticLoader } from "../ui/OptimisticLoader";

export type RouteLoadingShape = "settings" | "hub" | "list" | "cards";

const TITLES_BY_SHAPE: Record<RouteLoadingShape, string> = {
  hub: "Constructing your site hub",
  settings: "Setting up workspace controls",
  list: "Curating your website portfolio",
  cards: "Building your dashboard workspace",
};

const SUBTITLES_BY_SHAPE: Record<RouteLoadingShape, string> = {
  hub: "Bringing together your layout, live pages, and brand assets",
  settings: "Loading domains, integrations, and workspace preferences",
  list: "Checking live deployments, traffic, and site performance",
  cards: "Orchestrating metrics, active tools, and recent work",
};

const STEPS_BY_SHAPE: Record<RouteLoadingShape, string[]> = {
  hub: [
    "Assembling site layout and navigation…",
    "Loading content blocks, styles, and assets…",
    "Checking live domain and performance…",
    "Revealing your site workspace.",
  ],
  settings: [
    "Retrieving domain verification and SSL status…",
    "Connecting payment accounts and team preferences…",
    "Polishing workspace controls…",
    "Settings ready.",
  ],
  list: [
    "Connecting to distributed site deployments…",
    "Checking uptime, traffic, and visitor trends…",
    "Organizing your website directory…",
    "Portfolio ready.",
  ],
  cards: [
    "Compiling site activity and recent updates…",
    "Aligning workspace tools and shortcuts…",
    "Launching dashboard…",
    "Ready.",
  ],
};

/**
 * What a dashboard page shows while loading: an engaging optimistic loader with clear
 * dynamic steps rather than dead grey skeleton blocks.
 */
export function RouteLoading({ shape }: { shape: RouteLoadingShape }) {
  const title = TITLES_BY_SHAPE[shape] ?? TITLES_BY_SHAPE.hub;
  const steps = STEPS_BY_SHAPE[shape] ?? STEPS_BY_SHAPE.hub;
  const subtitle = SUBTITLES_BY_SHAPE[shape] ?? "Loading your workspace";

  return (
    <div
      className="plx-ldg plx-page"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      {/* The building page runs edge to edge: it cancels the content area's own padding (32px, or 20px/16px/96px on phones). */}
      <style>{`.plx-ldg{margin:-32px;width:calc(100% + 64px);height:calc(var(--plx-dvh, 100dvh) - 73px);display:block}.plx-ldg .plx-optimistic-loader{height:100%;min-height:0;border-radius:0}@media (max-width:900px){.plx-ldg{margin:-20px -16px calc(-96px - env(safe-area-inset-bottom));width:calc(100% + 32px);height:calc(var(--plx-dvh, 100dvh) - 64px - 68px - env(safe-area-inset-bottom))}}`}</style>
      <OptimisticLoader variant="page" title={title} steps={steps} subtitle={subtitle} />
    </div>
  );
}
