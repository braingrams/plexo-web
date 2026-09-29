"use client";

import { CheckCircle2, CircleAlert, CircleX, Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type StepStatus = "pending" | "running" | "success" | "error" | "cancelled";

const STATUS_META: Record<StepStatus, { color: string; bg: string; border: string; label: string }> = {
  pending: { color: "rgba(240,242,255,0.45)", bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", label: "Queued" },
  running: { color: "#c4b5fd", bg: "rgba(var(--brand-rgb),0.08)", border: "rgba(var(--brand-rgb),0.25)", label: "Running" },
  success: { color: "#34d399", bg: "rgba(52,211,153,0.07)", border: "rgba(52,211,153,0.2)", label: "Done" },
  error: { color: "#f87171", bg: "rgba(248,113,113,0.07)", border: "rgba(248,113,113,0.2)", label: "Failed" },
  cancelled: { color: "rgba(240,242,255,0.4)", bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.07)", label: "Cancelled" },
};

function StatusIcon({ status }: { status: StepStatus }) {
  const meta = STATUS_META[status];
  if (status === "running") return <Loader2 size={14} color={meta.color} style={{ animation: "sol-spin 0.9s linear infinite" }} />;
  if (status === "success") return <CheckCircle2 size={14} color={meta.color} />;
  if (status === "error") return <CircleX size={14} color={meta.color} />;
  if (status === "cancelled") return <CircleAlert size={14} color={meta.color} />;
  return <CircleAlert size={14} color={meta.color} />;
}

/** Shared "one collapsible step" chrome for ToolCallCard/FileReadCard — a compact pill row
 * that can carry any icon + label + status pill, with optional expandable detail content. */
export function StepCard({
  icon: Icon,
  iconColor,
  title,
  subtitle,
  status,
  children,
  footer,
}: {
  icon: LucideIcon;
  iconColor?: string;
  title: string;
  subtitle?: string;
  status: StepStatus;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const meta = STATUS_META[status];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: children ? "0.6rem" : 0,
        borderRadius: 12,
        border: `1px solid ${meta.border}`,
        background: meta.bg,
        padding: "0.65rem 0.85rem",
        maxWidth: 480,
      }}
    >
      <style>{`@keyframes sol-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 8, background: "rgba(255,255,255,0.04)", flexShrink: 0 }}>
          <Icon size={14} color={iconColor ?? "rgba(240,242,255,0.6)"} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f0f2ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</p>
          {subtitle && <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.4)", marginTop: 1 }}>{subtitle}</p>}
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            color: meta.color,
            flexShrink: 0,
          }}
        >
          <StatusIcon status={status} />
          {meta.label}
        </span>
      </div>
      {children}
      {footer}
    </div>
  );
}
