"use client";

import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { setSolLaunchOrigin } from "./SolEntranceOverlay";

/**
 * The one "enter SOL" icon button — used from both dashboard shells' top bars. Stashes the
 * click's viewport coordinates (SolEntranceOverlay reads them back to bloom its reveal
 * glow from this exact point) before navigating, and fires a best-effort preference save
 * so SOL becomes this user's landing surface next time they log in — never awaited, never
 * blocks the navigation it's attached to.
 */
export function SolToggleButton({ size = 18 }: { size?: number }) {
  const router = useRouter();

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setSolLaunchOrigin(rect.left + rect.width / 2, rect.top + rect.height / 2);
    router.push("/dashboard/sol");
    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredSurface: "SOL" }),
    }).catch(() => {});
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Open SOL"
      title="Open SOL — your AI agent"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 9,
        border: "1px solid rgba(168,85,247,0.28)",
        background: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(124,58,237,0.1))",
        color: "#e9d5ff",
        cursor: "pointer",
        boxShadow: "0 0 14px rgba(168,85,247,0.22)",
        flexShrink: 0,
      }}
    >
      <Sparkles size={size * 0.72} />
    </button>
  );
}
