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
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        flexWrap: "wrap",
        gap: "1rem",
        marginBottom: isModern ? "2.25rem" : "2rem",
      }}
    >
      <div>
        {eyebrow && (
          <p
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--brand)",
              marginBottom: "0.35rem",
            }}
          >
            {eyebrow}
          </p>
        )}
        <h1
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: isModern ? "clamp(1.8rem, 3vw, 2.4rem)" : "clamp(1.6rem, 3vw, 2.1rem)",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            color: "#f0f2ff",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.45)", marginTop: "0.35rem" }}>{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}
