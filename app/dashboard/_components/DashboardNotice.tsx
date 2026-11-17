"use client";

import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import Link from "next/link";
import { Notice } from "../_v3/ui/Notice";
import { useIsV3 } from "../_v3/theme/ThemeContext";

// The one look for notices above dashboard pages (plan status, a WordPress site moving
// in). Sits inside the same column and side padding as the page below it — never pinned
// to the edge of the window — as a quiet card: an icon, one line of headline + detail,
// an optional progress bar, one action, and a close button.

export type NoticeTone = "brand" | "warning" | "success";

const TONES: Record<NoticeTone, { accent: string; tile: string; ring: string; bar: string }> = {
  brand: { accent: "var(--plx-violet, #c4b5fd)", tile: "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 14%, transparent)", ring: "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 22%, transparent)", bar: "var(--brand)" },
  warning: { accent: "var(--plx-warning, #fcd34d)", tile: "color-mix(in srgb, var(--plx-warning, rgb(245 183 74)) 13%, transparent)", ring: "color-mix(in srgb, var(--plx-warning, rgb(245 183 74)) 24%, transparent)", bar: "#f5b74a" },
  success: { accent: "var(--plx-success, #6ee7b7)", tile: "rgba(110,231,168,0.12)", ring: "rgba(110,231,168,0.22)", bar: "var(--plx-success, #6ee7a8)" },
};

export type NoticeAction = { label: string; href?: string; onClick?: () => void; busy?: boolean; variant?: "primary" | "quiet" };

export function DashboardNotice({
  tone,
  icon: Icon,
  title,
  detail,
  actions = [],
  progress,
  onDismiss,
}: {
  tone: NoticeTone;
  icon: LucideIcon;
  title: string;
  detail?: string;
  actions?: NoticeAction[];
  /** 0–1: draws a thin bar under the text (trial days used, a migration's progress). */
  progress?: number;
  onDismiss?: () => void;
}) {
  const inV3 = useIsV3();
  const t = TONES[tone];
  if (inV3) {
    // The new dashboard has its own theme-aware banner; the old dashboard keeps the look below.
    const first = actions[0];
    return (
      <Notice
        kind={tone === "warning" ? "warning" : tone === "success" ? "success" : "info"}
        icon={Icon}
        title={title}
        progress={progress}
        action={first ? { label: first.label, href: first.href, onClick: first.onClick, busy: first.busy } : undefined}
        onDismiss={onDismiss}
      >
        {detail}
      </Notice>
    );
  }
  return (
    <div className="dashboard-notice-wrap" style={{ padding: "1.5rem 32px 0", maxWidth: 1920, width: "100%", margin: "0 auto" }}>
      <div
        role="status"
        className="dashboard-notice"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 10px 10px 12px",
          borderRadius: 14,
          background: "color-mix(in srgb, var(--plx-text, #fff) 2.5%, transparent)",
          border: `1px solid ${t.ring}`,
        }}
      >
        <span
          aria-hidden
          style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: t.tile, color: t.accent }}
        >
          <Icon size={17} strokeWidth={2.2} />
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "var(--plx-muted, rgba(240,242,255,0.6))" }}>
            <span style={{ fontWeight: 700, color: "var(--plx-text, #f0f2ff)" }}>{title}</span>
            {detail ? <span className="dashboard-notice-detail"> · {detail}</span> : null}
          </p>
          {typeof progress === "number" && (
            <div style={{ height: 3, borderRadius: 999, background: "color-mix(in srgb, var(--plx-text, #fff) 7%, transparent)", marginTop: 7, maxWidth: 320, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`, background: t.bar, borderRadius: 999, transition: "width 0.6s" }} />
            </div>
          )}
        </div>

        <div className="dashboard-notice-actions" style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {actions.map((a) => {
            const style = a.variant === "quiet" ? quietButton : { ...primaryButton, color: t.accent, background: t.tile };
            const content = a.busy ? "One moment…" : a.label;
            return a.href ? (
              <Link key={a.label} href={a.href} style={style}>
                {content}
              </Link>
            ) : (
              <button key={a.label} type="button" onClick={a.onClick} disabled={a.busy} style={{ ...style, opacity: a.busy ? 0.7 : 1 }}>
                {content}
              </button>
            );
          })}
          {onDismiss && (
            <button type="button" onClick={onDismiss} aria-label="Dismiss" className="dashboard-notice-close" style={closeButton}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      <style>{`
        @media (max-width: 720px) {
          .dashboard-notice-wrap { padding: 1rem 16px 0 !important; }
          .dashboard-notice { flex-wrap: wrap; align-items: flex-start !important; padding-right: 40px !important; }
          .dashboard-notice-actions { width: 100%; padding-left: 48px; flex-wrap: wrap; }
          .dashboard-notice-close { position: absolute; top: 8px; right: 8px; }
        }
      `}</style>
    </div>
  );
}

const primaryButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 32,
  padding: "0 12px",
  borderRadius: 9,
  border: "none",
  fontSize: 12.5,
  fontWeight: 700,
  textDecoration: "none",
  whiteSpace: "nowrap",
  cursor: "pointer",
  fontFamily: "inherit",
};

const quietButton: React.CSSProperties = {
  ...primaryButton,
  background: "transparent",
  color: "var(--plx-muted, rgba(240,242,255,0.7))",
  fontWeight: 600,
};

const closeButton: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "var(--plx-muted, rgba(240,242,255,0.4))",
  cursor: "pointer",
};
