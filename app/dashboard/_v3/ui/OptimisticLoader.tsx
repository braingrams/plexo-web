"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";

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
    }, 1800);
    return () => clearTimeout(timer);
  }, [currentStepIndex, steps.length]);

  const activeStepText = steps[currentStepIndex];

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
        padding: "48px 24px",
        textAlign: "center",
        gap: 24,
        maxWidth: 580,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 72,
          height: 72,
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "color-mix(in srgb, var(--plx-brand) 25%, transparent)",
            animation: "plx-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
          aria-hidden
        />
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: "50%",
            background: "var(--plx-tint)",
            border: "2px solid var(--plx-deep, var(--plx-brand))",
            color: "var(--plx-deep, var(--plx-brand))",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 0 16px color-mix(in srgb, var(--plx-brand) 30%, transparent)",
            zIndex: 1,
          }}
        >
          <Sparkles size={26} className="plx-spin-slow" />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "-0.015em",
            color: "var(--plx-text)",
            margin: 0,
          }}
        >
          {title ?? (stage === "making-site" ? `Making ${siteName}…` : `Finding the best look for ${siteName}…`)}
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "var(--plx-muted)",
            margin: 0,
            minHeight: 24,
            transition: "opacity 0.2s ease, transform 0.2s ease",
          }}
        >
          {subtitle ?? activeStepText}
        </p>
      </div>

      {/* Progress pill steps list */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          width: "100%",
          maxWidth: 420,
          background: "var(--plx-surface)",
          border: "1px solid var(--plx-border)",
          borderRadius: 14,
          padding: "16px 20px",
          textAlign: "left",
          boxShadow: "var(--plx-shadow-card)",
        }}
      >
        {steps.map((step, idx) => {
          const isDone = idx < currentStepIndex;
          const isCurrent = idx === currentStepIndex;
          return (
            <div
              key={step}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 13,
                fontWeight: isCurrent ? 700 : isDone ? 600 : 500,
                color: isCurrent ? "var(--plx-text)" : isDone ? "var(--plx-muted)" : "color-mix(in srgb, var(--plx-muted) 60%, transparent)",
                transition: "all 0.25s ease",
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  background: isDone
                    ? "var(--plx-deep, var(--plx-brand))"
                    : isCurrent
                    ? "color-mix(in srgb, var(--plx-brand) 25%, transparent)"
                    : "var(--plx-sunken)",
                  color: isDone ? "var(--plx-on-brand, var(--plx-surface))" : "var(--plx-deep, var(--plx-brand))",
                  border: isCurrent ? "1.5px solid var(--plx-deep, var(--plx-brand))" : "none",
                }}
              >
                {isDone ? (
                  <Check size={12} strokeWidth={3} />
                ) : isCurrent ? (
                  <Loader2 size={12} className="plx-spin" />
                ) : (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", opacity: 0.4 }} />
                )}
              </div>
              <span style={{ flex: 1 }}>{step}</span>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes plx-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.15); }
        }
        @keyframes plx-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .plx-spin {
          animation: plx-spin 1s linear infinite;
        }
        .plx-spin-slow {
          animation: plx-spin 8s linear infinite;
        }
      `}</style>
    </div>
  );
}
