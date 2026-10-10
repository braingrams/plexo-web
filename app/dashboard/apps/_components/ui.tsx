"use client";

import type { CSSProperties, ReactNode, ButtonHTMLAttributes, ComponentType } from "react";
import { CloudOff, RefreshCw } from "lucide-react";

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

export function Panel({ title, description, actions, children, style, icon, iconColor = C.brand }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; style?: CSSProperties; icon?: ReactNode; iconColor?: string }) {
  const heading = (title || actions) && (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", marginBottom: description ? "0.25rem" : "0.8rem" }}>
      {title && <h3 style={{ margin: 0, fontSize: icon ? "1rem" : "0.92rem", fontWeight: 700, color: C.text }}>{title}</h3>}
      {actions && <div style={{ display: "flex", gap: "0.4rem" }}>{actions}</div>}
    </div>
  );
  const blurb = description && <p style={{ margin: "0 0 0.85rem", fontSize: icon ? "0.8rem" : "0.76rem", color: C.muted, lineHeight: 1.5 }}>{description}</p>;
  return (
    <section style={{ border: `1px solid ${C.border}`, background: C.panel, borderRadius: icon ? 18 : 14, padding: icon ? "1.3rem 1.4rem" : "1rem 1.1rem", ...style }}>
      {icon ? (
        // With an icon: a tinted tile beside the heading, the content lined up under the words.
        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: 14 }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: `${iconColor}24`, color: iconColor, gridRow: "span 3" }}>{icon}</span>
          <div>{heading}{blurb}</div>
          <div style={{ gridColumn: 2 }}>{children}</div>
        </div>
      ) : (
        <>
          {heading}
          {blurb}
          {children}
        </>
      )}
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
  if (s < 86400 * 2) return "yesterday";
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** The heading row every editor page starts with: what this page is, then its controls. */
export function PaneHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "0.8rem 1.2rem", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: "1 1 320px" }}>
        <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: C.text }}>{title}</h2>
        {subtitle && <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: C.muted, lineHeight: 1.5 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

/** A page with nothing in it yet: what will show up here, and the quickest ways to get there. */
export function GettingStarted({ icon, title, body, children }: { icon: ReactNode; title: string; body: ReactNode; children?: ReactNode }) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        gap: "1.1rem",
        alignItems: "start",
        padding: "1.6rem",
        borderRadius: 16,
        border: `1px dashed ${C.borderStrong}`,
        background: "radial-gradient(90% 120% at 100% 0%, rgba(139,92,246,0.12), transparent 60%), rgba(255,255,255,0.015)",
      }}
    >
      <span style={{ width: 46, height: 46, borderRadius: 13, display: "grid", placeItems: "center", background: "rgba(139,92,246,0.16)", color: "#c4b5fd" }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: C.text }}>{title}</h3>
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: C.muted, lineHeight: 1.55, maxWidth: 720 }}>{body}</p>
        {children && <div style={{ marginTop: "1rem" }}>{children}</div>}
      </div>
    </section>
  );
}

/** One-tap prompts for SOL. */
export function SolIdeas({ ideas, onPick }: { ideas: string[]; onPick: (idea: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
      {ideas.map((idea) => (
        <button
          key={idea}
          type="button"
          onClick={() => onPick(idea)}
          style={{ textAlign: "left", padding: "0.65rem 0.8rem", borderRadius: 11, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontSize: "0.8rem", lineHeight: 1.4, cursor: "pointer" }}
        >
          {idea}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ page states
// Every editor page uses these for loading, problems, empty and summary states, so they all
// look and behave the same: a shimmering outline while loading, a plain-words problem with a
// Try again, a wide illustrated empty state, and colourful stat cards.

/** Mount once per page that uses Shimmer / IconButton hover styles. */
export function StateStyles() {
  return (
    <style>{`
.plx-shimmer { display: block; background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.09), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: plx-shimmer 1.4s ease-in-out infinite; }
@keyframes plx-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.plx-icon-btn { transition: color 0.15s, border-color 0.15s, background 0.15s; }
.plx-icon-btn:not(:disabled):hover { color: #f0f2ff; border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); }
.plx-icon-btn.is-danger:not(:disabled):hover { color: #f87171; border-color: rgba(248,113,113,0.4); background: rgba(248,113,113,0.08); }
.plx-row { transition: background 0.15s; }
.plx-row:hover { background: rgba(255,255,255,0.025); }
.plx-lift { transition: transform 0.15s, border-color 0.15s, background 0.15s; }
.plx-lift:not(:disabled):hover { transform: translateY(-1px); border-color: rgba(139,92,246,0.5) !important; }
@media (max-width: 1000px) { .plx-hero { grid-template-columns: minmax(0, 1fr) !important; } .plx-hero-art { display: none !important; } }
@media (prefers-reduced-motion: reduce) { .plx-shimmer { animation: none; } .plx-lift:hover { transform: none !important; } }
`}</style>
  );
}

/** One shimmering placeholder bar or block. */
export function Shimmer({ width = "100%", height = 12, radius = 8, style }: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }) {
  return <span className="plx-shimmer" aria-hidden style={{ width, height, borderRadius: radius, flexShrink: 0, ...style }} />;
}

/** A loading list: rows with a round icon, two lines and a tag. */
export function ListSkeleton({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  const widths = [62, 48, 70, 54, 44, 58, 66];
  return (
    <div aria-busy="true" aria-label={label} style={{ border: `1px solid ${C.border}`, borderRadius: 18, padding: "0.4rem 1rem" }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "0.85rem 0", borderBottom: i < rows - 1 ? `1px solid ${C.border}` : "none" }}>
          <Shimmer width={36} height={36} radius={99} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
            <Shimmer width={`${widths[i % widths.length]}%`} height={11} radius={99} />
            <Shimmer width="22%" height={8} radius={99} />
          </span>
          <Shimmer width={64} height={22} radius={99} />
        </div>
      ))}
    </div>
  );
}

/** Couldn't load: what happened in plain words, reassurance, and a way forward. */
export function ProblemState({ title, message, onRetry }: { title: string; message?: ReactNode; onRetry?: () => void }) {
  return (
    <section role="alert" style={{ display: "flex", alignItems: "center", gap: "1.2rem", flexWrap: "wrap", padding: "1.8rem 2rem", borderRadius: 20, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.05)" }}>
      <span style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "rgba(251,191,36,0.14)", color: C.warning, flexShrink: 0 }}>
        <CloudOff size={22} />
      </span>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: C.text }}>{title}</h3>
        {message && <p style={{ margin: "0.3rem 0 0", fontSize: "0.84rem", color: C.muted, lineHeight: 1.55 }}>{message}</p>}
      </div>
      {onRetry && (
        <Button variant="primary" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </Button>
      )}
    </section>
  );
}

/** A page with nothing in it yet: a wide, tinted panel — words and actions on the left, a
 *  picture on the right. `tint` colours the glow (defaults to brand purple). */
export function EmptyHero({ title, body, children, art, tint = "#8b5cf6" }: { title: string; body: ReactNode; children?: ReactNode; art?: ReactNode; tint?: string }) {
  return (
    <section
      className="plx-hero"
      style={{
        display: "grid",
        gridTemplateColumns: art ? "minmax(0, 1fr) minmax(0, 0.85fr)" : "minmax(0, 1fr)",
        gap: "2rem",
        alignItems: "center",
        padding: "clamp(1.2rem, 4.5vw, 2.2rem)",
        borderRadius: 20,
        border: `1px solid ${C.border}`,
        background: `radial-gradient(70% 90% at 100% 0%, ${tint}24, transparent 60%), radial-gradient(60% 80% at 0% 100%, rgba(139,92,246,0.08), transparent 60%), rgba(255,255,255,0.015)`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem", minWidth: 0 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "clamp(1.1rem, 4.2vw, 1.35rem)", fontWeight: 750, letterSpacing: "-0.01em", color: C.text }}>{title}</h3>
          <div style={{ margin: "0.45rem 0 0", fontSize: "0.88rem", color: C.muted, lineHeight: 1.6, maxWidth: 560 }}>{body}</div>
        </div>
        {children}
      </div>
      {art && (
        <div className="plx-hero-art" aria-hidden>
          {art}
        </div>
      )}
    </section>
  );
}

/** A coloured summary number. */
export function StatCard({ label, value, color, icon: Icon }: { label: string; value: ReactNode; color: string; icon: ComponentType<{ size?: number }> }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "1rem 1.1rem", borderRadius: 16, border: `1px solid ${C.border}`, background: `linear-gradient(135deg, ${color}1f, transparent 70%)` }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: `${color}2e`, color, flexShrink: 0 }}>
        <Icon size={19} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "clamp(1.1rem, 4.2vw, 1.35rem)", fontWeight: 750, lineHeight: 1.15, color: C.text }}>{value}</span>
        <span style={{ display: "block", fontSize: "0.76rem", color: C.muted, marginTop: 2 }}>{label}</span>
      </span>
    </div>
  );
}

/** A small coloured status tag with a dot. */
export function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, fontSize: "0.7rem", fontWeight: 650, color, background: `${color}1f`, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: color }} />
      {children}
    </span>
  );
}

/** A square icon-only button with a tooltip (label is required — it's the accessible name). */
export function IconButton({ label, danger, disabled, onClick, children }: { label: string; danger?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`plx-icon-btn${danger ? " is-danger" : ""}`}
      style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 9, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}
    >
      {children}
    </button>
  );
}

// Picked per name so the same thing always gets the same colour. Plexo's own purple family only:
// brand, orchid, indigo, deep violet — status colours (C.success/warning/danger) are the only others.
export const HUES = ["#8b5cf6", "#c084fc", "#6366f1", "#7c3aed", "#a78bfa", "#6d28d9", "#9333ea", "#818cf8"];
export function hueGradient(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `linear-gradient(135deg, ${HUES[h % HUES.length]}, ${HUES[(h + 3) % HUES.length]})`;
}
