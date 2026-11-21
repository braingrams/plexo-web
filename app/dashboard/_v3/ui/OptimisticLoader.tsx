"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";

export type OptimisticLoaderProps = {
  siteName?: string;
  stage?: "finding-designs" | "making-site" | "switching-site" | "loading-assets";
  steps?: string[];
  title?: string;
  subtitle?: string;
};

const DEFAULT_STEPS: Record<string, (name: string) => string[]> = {
  "finding-designs": (name) => [
    "Putting together your brand data…",
    `Looking for the best templates that represent ${name || "your brand"} properly…`,
    "Matching design styles, palettes, and typography…",
    "Preparing your high-res interactive preview…",
  ],
  "making-site": (name) => [
    `Saving brand details for ${name || "your website"}…`,
    "Generating responsive pages and interactive blocks…",
    "Setting up design tokens and assets in the background…",
    "Polishing everything up for your first edit…",
  ],
  "switching-site": (name) => [
    `Switching workspace context to ${name || "your site"}…`,
    "Loading pages, settings, and features…",
    "Ready!",
  ],
  "loading-assets": (name) => [
    "Loading assets and styles…",
    `Configuring canvas for ${name || "your website"}…`,
  ],
};

export function OptimisticLoader({
  siteName = "your site",
  stage = "finding-designs",
  steps: customSteps,
  title,
  subtitle,
}: OptimisticLoaderProps) {
  const steps = customSteps ?? (DEFAULT_STEPS[stage] ? DEFAULT_STEPS[stage](siteName) : DEFAULT_STEPS["finding-designs"](siteName));
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    if (currentStepIndex >= steps.length - 1) return;
    const timer = setTimeout(() => {
      setCurrentStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 1600);
    return () => clearTimeout(timer);
  }, [currentStepIndex, steps.length]);

  const activeStepText = steps[currentStepIndex];
  const resolvedTitle = title ?? (stage === "making-site" ? `Making ${siteName}…` : stage === "finding-designs" ? `Finding the best look for ${siteName}…` : "Constructing your workspace…");
  const progressPercent = Math.min(100, Math.round(((currentStepIndex + 1) / steps.length) * 100));

  return (
    <div
      role="status"
      aria-live="polite"
      className="plx-optimistic-loader"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        textAlign: "center",
        gap: 20,
        maxWidth: 520,
        margin: "0 auto",
        width: "100%",
      }}
    >
      {/* Sleek architectural reveal emblem */}
      <div
        style={{
          position: "relative",
          width: 58,
          height: 58,
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "color-mix(in srgb, var(--plx-brand) 18%, transparent)",
            animation: "plx-pulse 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
          aria-hidden
        />
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            background: "var(--plx-surface)",
            border: "1px solid var(--plx-border-strong)",
            color: "var(--plx-deep, var(--plx-brand))",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 0 20px color-mix(in srgb, var(--plx-brand) 20%, transparent)",
            zIndex: 1,
          }}
        >
          <Loader2 size={22} className="plx-spin" />
        </div>
      </div>

      {/* Main title & subtitle with refined typography */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: "var(--plx-text)",
            margin: 0,
          }}
        >
          {resolvedTitle}
        </h2>
        {subtitle ? (
          <p
            style={{
              fontSize: 14,
              color: "var(--plx-muted)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {/* Refined construction progression track */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: "100%",
          maxWidth: 380,
          margin: "4px auto 0",
        }}
      >
        <div
          style={{
            width: "100%",
            height: 3,
            borderRadius: 999,
            background: "var(--plx-border)",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              width: `${progressPercent}%`,
              height: "100%",
              background: "var(--plx-brand)",
              borderRadius: 999,
              transition: "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: "0 0 8px var(--plx-brand)",
            }}
          />
        </div>

        {/* Active construction milestone */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            minHeight: 22,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textAlign: "left",
              minWidth: 0,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--plx-brand)",
                boxShadow: "0 0 6px var(--plx-brand)",
                flexShrink: 0,
              }}
              aria-hidden
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--plx-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                transition: "opacity 0.2s ease",
              }}
            >
              {activeStepText}
            </span>
          </div>

          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--plx-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              flexShrink: 0,
            }}
          >
            {currentStepIndex + 1}/{steps.length}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes plx-pulse {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.18); }
        }
        @keyframes plx-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .plx-spin {
          animation: plx-spin 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
    </div>
  );
}
