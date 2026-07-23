"use client";

import { useLayoutMode } from "../layout-mode-context";

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
};

/** Layout-mode-aware page title block. Replaces the eyebrow/h1/subtitle markup duplicated at the top of every dashboard page. */
export function PageHeader({ eyebrow, title, subtitle, action }: Props) {
  const { mode } = useLayoutMode();
  const isModern = mode === "MODERN";

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4"
      style={{
        marginBottom: isModern ? "1.75rem" : "1.5rem",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <p
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--brand)",
              marginBottom: "0.25rem",
            }}
          >
            {eyebrow}
          </p>
        )}
        <h1
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: isModern ? "clamp(1.35rem, 3.5vw, 2.2rem)" : "clamp(1.25rem, 3.5vw, 1.95rem)",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            color: "#f0f2ff",
            lineHeight: 1.2,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.45)", marginTop: "0.35rem", lineHeight: 1.45 }}>{subtitle}</p>
        )}
      </div>
      {action && (
        <div style={{ flexShrink: 0, marginTop: "0.25rem" }}>
          {action}
        </div>
      )}
    </div>
  );
}
