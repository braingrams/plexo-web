"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * The header strip for SOL's own subpages (Settings, Memory) — same height/border/blur as
 * SolHeader's own conversation strip (see that file's own comment on why the height is a
 * fixed 61px, not just matching padding), so navigating from a chat into Settings/Memory
 * feels like moving to another view inside the same app, not landing on a bare, unrelated
 * page that happened to have SOL's sidebar next to it.
 */
export function SolSubpageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const router = useRouter();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        height: 61,
        boxSizing: "border-box",
        padding: "0 1.25rem",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(10,7,16,0.55)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={() => router.push("/dashboard/sol")}
        aria-label="Back to Sol"
        title="Back to Sol"
        style={{
          display: "grid",
          placeItems: "center",
          width: 32,
          height: 32,
          borderRadius: 9,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
          color: "rgba(240,242,255,0.65)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <ArrowLeft size={15} />
      </button>
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-heading), sans-serif",
            fontWeight: 700,
            fontSize: "0.92rem",
            color: "#f3f0fa",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: 0, fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
