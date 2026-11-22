"use client";

import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { SolGlyph } from "@/app/dashboard/_v3/sol/SolGlyph";

const STEPS = [
  {
    title: "Analyzing brand identity & goals",
    detail: "Synthesizing your business description, domain, and target audience…",
  },
  {
    title: "Curating authentic domain photography",
    detail: "Replacing generic stock with curated high-resolution photography…",
  },
  {
    title: "Writing bespoke copy & bento cards",
    detail: "Crafting headlines, story sections, and call-to-action buttons…",
  },
  {
    title: "Assembling personalized website code",
    detail: "Styling layout elements and preparing your live preview…",
  },
];

export function SolWorkingCanvas({ siteName }: { siteName?: string }) {
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(15);

  useEffect(() => {
    const stepInterval = setInterval(() => {
      setActiveStep((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
    }, 1800);

    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev < 90 ? prev + 3 : prev));
    }, 200);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progressInterval);
    };
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        background: "var(--plx-sunken)",
        overflow: "hidden",
      }}
    >
      {/* Central SOL AI Hero Card */}
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--plx-surface)",
          border: "1px solid var(--plx-border)",
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 10px 30px var(--plx-tint)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
        }}
      >
        {/* Pulsing SOL Glyph Avatar */}
        <div
          style={{
            position: "relative",
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "var(--plx-tint)",
            border: "1px solid var(--plx-border)",
            display: "grid",
            placeItems: "center",
            color: "var(--plx-deep)",
          }}
        >
          <SolGlyph size={28} />
        </div>

        {/* Heading & Subtitle */}
        <div style={{ textAlign: "center" }}>
          <h3
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: "var(--plx-heading)",
            }}
          >
            SOL is personalizing your website
          </h3>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--plx-muted)",
              lineHeight: 1.4,
            }}
          >
            Tailoring copy, media cards, and photography for{" "}
            <strong style={{ color: "var(--plx-heading)" }}>{siteName || "your brand"}</strong>…
          </p>
        </div>

        {/* Animated Progress Bar */}
        <div
          style={{
            width: "100%",
            height: 6,
            borderRadius: 999,
            background: "var(--plx-sunken)",
            overflow: "hidden",
            border: "1px solid var(--plx-border)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "var(--plx-deep)",
              borderRadius: 999,
              transition: "width 0.2s ease-out",
            }}
          />
        </div>

        {/* Dynamic Multi-Step Progress List */}
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 4,
          }}
        >
          {STEPS.map((step, idx) => {
            const isDone = idx < activeStep;
            const isCurrent = idx === activeStep;
            return (
              <div
                key={step.title}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  opacity: isDone ? 0.7 : isCurrent ? 1 : 0.4,
                  transition: "opacity 0.3s ease",
                }}
              >
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    marginTop: 1,
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    background: isDone
                      ? "var(--plx-deep)"
                      : isCurrent
                      ? "var(--plx-tint)"
                      : "var(--plx-sunken)",
                    color: isDone
                      ? "var(--plx-surface)"
                      : isCurrent
                      ? "var(--plx-deep)"
                      : "var(--plx-muted)",
                    border: `1px solid ${isCurrent ? "var(--plx-border)" : "transparent"}`,
                  }}
                >
                  {isDone ? (
                    <Check size={12} strokeWidth={3} />
                  ) : isCurrent ? (
                    <RefreshCw size={11} className="plx-spin" />
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700 }}>{idx + 1}</span>
                  )}
                </div>

                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: isCurrent ? "var(--plx-heading)" : "var(--plx-body)",
                    }}
                  >
                    {step.title}
                  </div>
                  {isCurrent && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--plx-muted)",
                        marginTop: 2,
                      }}
                    >
                      {step.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
