"use client";

import { CSSProperties } from "react";
import { MODERN } from "@/lib/theme";
import { useLayoutMode } from "../layout-mode-context";

type Props = {
  children: React.ReactNode;
  style?: CSSProperties;
  className?: string;
  /** Set false to omit the default card padding (e.g. when the child manages its own). */
  padded?: boolean;
};

/** Layout-mode-aware card surface. Swap raw inline-styled div wrappers for this to get automatic Classic/Modern re-skinning. */
export function Card({ children, style, className, padded = true }: Props) {
  const { mode } = useLayoutMode();
  const isModern = mode === "MODERN";

  const baseStyle: CSSProperties = isModern
    ? {
        background: MODERN.surface.fill,
        border: `1px solid ${MODERN.surface.border}`,
        borderRadius: MODERN.radius.lg,
        padding: padded ? MODERN.spacing.cardPad : undefined,
        boxShadow: MODERN.shadow.card,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }
    : {
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 16,
        padding: padded ? "1.75rem" : undefined,
        boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
      };

  return (
    <div className={className} style={{ ...baseStyle, ...style }}>
      {children}
    </div>
  );
}
