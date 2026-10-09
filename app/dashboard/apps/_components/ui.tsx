"use client";

import type { CSSProperties, ReactNode, ButtonHTMLAttributes } from "react";

// The app editor's visual language — the same dark, translucent surfaces as SOL (see
// app/dashboard/sol/_components), so the editor reads as one product with the chat beside it.

export const C = {
  bg: "#0b0f19",
  panel: "rgba(255,255,255,0.025)",
  panelSolid: "#11162a",
  border: "rgba(255,255,255,0.07)",
  borderStrong: "rgba(255,255,255,0.12)",
  text: "#f0f2ff",
  muted: "rgba(240,242,255,0.55)",
  faint: "rgba(240,242,255,0.35)",
  brand: "#8b5cf6",
  brandDeep: "#7c3aed",
  danger: "#f87171",
  warning: "#fbbf24",
  success: "#34d399",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export function Button({
  variant = "secondary",
  size = "md",
  style,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    borderRadius: 9,
    fontSize: size === "sm" ? "0.74rem" : "0.8rem",
    fontWeight: 600,
    padding: size === "sm" ? "0.32rem 0.6rem" : "0.48rem 0.85rem",
    cursor: rest.disabled ? "not-allowed" : "pointer",
    opacity: rest.disabled ? 0.55 : 1,
    border: "1px solid transparent",
    whiteSpace: "nowrap",
    transition: "background 0.15s, border-color 0.15s",
  };
  const variants: Record<string, CSSProperties> = {
    primary: { background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: "#fff" },
    secondary: { background: "rgba(255,255,255,0.05)", borderColor: C.border, color: C.text },
    ghost: { background: "transparent", color: C.muted },
    danger: { background: "rgba(248,113,113,0.12)", borderColor: "rgba(248,113,113,0.25)", color: C.danger },
  };
  return (
    <button type="button" {...rest} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

export function Panel({ title, description, actions, children, style }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ border: `1px solid ${C.border}`, background: C.panel, borderRadius: 14, padding: "1rem 1.1rem", ...style }}>
      {(title || actions) && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", marginBottom: description ? "0.25rem" : "0.8rem" }}>
          {title && <h3 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: C.text }}>{title}</h3>}
          {actions && <div style={{ display: "flex", gap: "0.4rem" }}>{actions}</div>}
        </div>
      )}
      {description && <p style={{ margin: "0 0 0.85rem", fontSize: "0.76rem", color: C.muted, lineHeight: 1.5 }}>{description}</p>}
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "danger" | "warning" | "success"; children: ReactNode }) {
  const colors = { info: C.brand, danger: C.danger, warning: C.warning, success: C.success }[tone];
  return (
    <div style={{ padding: "0.6rem 0.8rem", borderRadius: 10, background: `${colors}14`, border: `1px solid ${colors}40`, color: tone === "info" ? C.text : colors, fontSize: "0.78rem", lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

export function EnvSwitch({ value, onChange }: { value: "dev" | "live"; onChange: (env: "dev" | "live") => void }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }} role="tablist" aria-label="Environment">
      {(["dev", "live"] as const).map((env) => (
        <button
          key={env}
          type="button"
          role="tab"
          aria-selected={value === env}
          onClick={() => onChange(env)}
          style={{ padding: "0.32rem 0.7rem", fontSize: "0.74rem", fontWeight: 600, border: "none", cursor: "pointer", background: value === env ? "rgba(139,92,246,0.25)" : "transparent", color: value === env ? C.text : C.muted }}
        >
          {env === "dev" ? "Preview" : "Live"}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ padding: "2.5rem 1rem", textAlign: "center", color: C.muted }}>
      <p style={{ margin: "0 0 0.35rem", color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>{title}</p>
      {children && <div style={{ fontSize: "0.78rem", lineHeight: 1.6 }}>{children}</div>}
    </div>
  );
}

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.65rem",
  borderRadius: 9,
  border: `1px solid ${C.border}`,
  background: "rgba(255,255,255,0.04)",
  color: C.text,
  fontSize: "0.8rem",
  outline: "none",
};

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
