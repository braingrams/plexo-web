"use client";

import { OptimisticLoader } from "../_v3/ui/OptimisticLoader";

/**
 * The standard loading state for any dashboard route segment — displays an engaging
 * optimistic loader with active steps rather than dead grey shimmer blocks.
 */
export function PageSkeleton({ withSidebar = false }: { withSidebar?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        padding: "48px 24px",
        maxWidth: 1200,
        width: "100%",
        margin: "0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "55vh",
      }}
    >
      <OptimisticLoader
        title="Constructing your workspace view"
        subtitle="Assembling layout, live data, and controls"
        steps={[
          "Retrieving records and live data…",
          "Connecting workspace tools and assets…",
          "Revealing view.",
        ]}
      />
    </div>
  );
}
