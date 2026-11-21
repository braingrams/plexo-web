"use client";

import { OptimisticLoader } from "../ui/OptimisticLoader";

export type RouteLoadingShape = "settings" | "hub" | "list" | "cards";

const STEPS_BY_SHAPE: Record<RouteLoadingShape, string[]> = {
  hub: [
    "Switching workspace context to your site…",
    "Loading pages, settings, and features…",
    "Putting together your brand details and assets…",
    "Ready!",
  ],
  settings: [
    "Loading your site configuration…",
    "Retrieving domains, SEO, and integration settings…",
    "Ready!",
  ],
  list: [
    "Fetching your site records…",
    "Organizing workspace data…",
    "Ready!",
  ],
  cards: [
    "Loading your dashboard workspace…",
    "Retrieving your active sites and analytics…",
    "Ready!",
  ],
};

const SUBTITLES_BY_SHAPE: Record<RouteLoadingShape, string> = {
  hub: "Opening your site hub and features",
  settings: "Loading your workspace preferences",
  list: "Loading your websites and pages",
  cards: "Preparing your workspace dashboard",
};

/**
 * What a dashboard page shows while loading: an engaging optimistic loader with clear
 * dynamic steps rather than dead grey skeleton blocks.
 */
export function RouteLoading({ shape }: { shape: RouteLoadingShape }) {
  const steps = STEPS_BY_SHAPE[shape] ?? STEPS_BY_SHAPE.hub;
  const subtitle = SUBTITLES_BY_SHAPE[shape] ?? "Loading your workspace";

  return (
    <div
      className="plx-ldg plx-page"
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        minHeight: "55vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        padding: "48px 24px",
      }}
    >
      <OptimisticLoader steps={steps} subtitle={subtitle} />
    </div>
  );
}
