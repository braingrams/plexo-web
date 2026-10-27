"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

// The building blocks of the "Move from WordPress" wizard. Everything reads the dashboard's
// theme tokens, so it works in light and dark mode alike.

export const WIZARD_STEPS = ["Find your site", "Review", "Moving", "Check your site", "Go live"] as const;
export type WizardStep = 0 | 1 | 2 | 3 | 4;

export const tone = {
  good: "#34d399",
  goodBg: "rgba(52,211,153,0.08)",
  goodBorder: "rgba(52,211,153,0.3)",
  warn: "#f5b74a",
  warnBg: "rgba(245,183,74,0.08)",
  warnBorder: "rgba(245,183,74,0.35)",
  bad: "#f87171",
  badBg: "rgba(248,113,113,0.07)",
  badBorder: "rgba(248,113,113,0.35)",
};

export const text = {
  muted: { fontSize: 14, lineHeight: 1.6, color: "var(--text-muted)", margin: 0 } as React.CSSProperties,
  small: { fontSize: 12.5, lineHeight: 1.55, color: "var(--text-muted)", margin: 0 } as React.CSSProperties,
};

/** The row of steps across the top: done steps get a tick; done ones you can go back to are clickable. */
export function Stepper({ current, reachable, onSelect }: { current: WizardStep; reachable?: WizardStep[]; onSelect?: (step: WizardStep) => void }) {
  return (
    <nav aria-label="Migration steps" style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 36, overflowX: "auto", paddingBottom: 4 }}>
      {WIZARD_STEPS.map((label, i) => {
        const step = i as WizardStep;
        const done = i < current;
        const active = i === current;
        const clickable = Boolean(onSelect && reachable?.includes(step) && !active);
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < WIZARD_STEPS.length - 1 ? "1 1 0" : "0 0 auto", minWidth: 0 }}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect?.(step)}
              aria-current={active ? "step" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: clickable ? "pointer" : "default", fontFamily: "inherit", flexShrink: 0 }}
            >
              <span
                style={{
                  width: 28, height: 28, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 12.5, fontWeight: 700, flexShrink: 0,
                  background: done ? "var(--brand)" : active ? "rgba(var(--brand-rgb),0.14)" : "transparent",
                  color: done ? "#fff" : active ? "var(--brand)" : "var(--text-faint)",
                  border: `1.5px solid ${done || active ? "var(--brand)" : "var(--surface-border)"}`,
                  boxShadow: active ? "0 0 0 4px rgba(var(--brand-rgb),0.12)" : "none",
                  transition: "all 0.25s var(--ease-out)",
                }}
              >
                {done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span className="wiz-step-label" style={{ fontSize: 13, fontWeight: active ? 700 : 550, color: active ? "var(--text-main)" : done ? "var(--text-muted)" : "var(--text-faint)", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </button>
            {i < WIZARD_STEPS.length - 1 && (
              <span aria-hidden style={{ flex: 1, height: 2, minWidth: 16, margin: "0 12px", borderRadius: 2, background: done ? "var(--brand)" : "var(--surface-border)", transition: "background 0.3s" }} />
            )}
          </div>
        );
      })}
      <style>{`@media (max-width: 720px) { .wiz-step-label { display: none; } }`}</style>
    </nav>
  );
}

/** One step's page, using the full width: the title and the step's work on the left, and a
 *  side panel (what happens next, live progress, the site at a glance) on the right. Below
 *  1100px the side panel moves under the main column. */
export function StepShell({ icon, title, subtitle, aside, children }: { icon?: React.ReactNode; title: string; subtitle?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="wiz-grid" style={{ display: "grid", gridTemplateColumns: aside ? "minmax(0, 1fr) 360px" : "minmax(0, 1fr)", gap: 28, alignItems: "start", animation: "wiz-in 0.35s var(--ease-out)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          {icon && (
            <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(var(--brand-rgb),0.12)", color: "var(--brand)" }}>{icon}</span>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 750, letterSpacing: "-0.02em", lineHeight: 1.2, color: "var(--text-main)" }}>{title}</h1>
            {subtitle && <p style={{ ...text.muted, fontSize: 15, maxWidth: 760 }}>{subtitle}</p>}
          </div>
        </header>
        {children}
      </div>
      {aside && <aside style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>{aside}</aside>}
      <style>{`
        @keyframes wiz-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @media (max-width: 1100px) { .wiz-grid { grid-template-columns: minmax(0, 1fr) !important; } }
      `}</style>
    </section>
  );
}

/** A titled card for the side panel. */
export function AsideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--surface-border)", background: "var(--surface)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)" }}>{title}</p>
      {children}
    </div>
  );
}

/** A row in a side-panel list: an icon, a bold line and a short explanation. */
export function AsideItem({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <span style={{ color: "var(--brand)", flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text-main)" }}>{title}</p>
        {children && <p style={{ ...text.small, marginTop: 2 }}>{children}</p>}
      </div>
    </div>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--surface-border)", background: "var(--surface)", padding: 24, boxShadow: "var(--shadow-card)", ...style }}>
      {children}
    </div>
  );
}

export function PrimaryButton({ children, disabled, onClick, type = "button", size = "lg" }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void; type?: "button" | "submit"; size?: "lg" | "md" }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontSize: size === "lg" ? 15 : 13.5, fontWeight: 650, fontFamily: "inherit",
        padding: size === "lg" ? "14px 26px" : "10px 18px", borderRadius: 12, border: "none",
        color: "#fff", background: disabled ? "var(--text-faint)" : "linear-gradient(135deg, var(--brand), var(--brand-deeper))",
        boxShadow: disabled ? "none" : "0 8px 24px rgba(var(--brand-rgb),0.28)",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
    >
      {children}
    </button>
  );
}

export const secondaryButtonStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13.5, fontWeight: 600, fontFamily: "inherit",
  padding: "10px 16px", borderRadius: 12, border: "1px solid var(--surface-border)", background: "transparent", color: "var(--text-main)",
  cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap",
};

export function SecondaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...secondaryButtonStyle, opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
      {children}
    </button>
  );
}

/** A coloured note: good news, something to look at, or something wrong. */
export function Callout({ kind, title, children, icon }: { kind: "good" | "warn" | "bad" | "info"; title?: string; children?: React.ReactNode; icon?: React.ReactNode }) {
  const palette =
    kind === "good" ? [tone.goodBg, tone.goodBorder, tone.good]
    : kind === "warn" ? [tone.warnBg, tone.warnBorder, tone.warn]
    : kind === "bad" ? [tone.badBg, tone.badBorder, tone.bad]
    : ["rgba(var(--brand-rgb),0.06)", "rgba(var(--brand-rgb),0.25)", "var(--brand)"];
  return (
    <div style={{ display: "flex", gap: 12, padding: "14px 16px", borderRadius: 12, background: palette[0], border: `1px solid ${palette[1]}` }}>
      {icon && <span style={{ color: palette[2], flexShrink: 0, marginTop: 1 }}>{icon}</span>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        {title && <p style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text-main)" }}>{title}</p>}
        {children && <div style={{ ...text.small, fontSize: 13.5 }}>{children}</div>}
      </div>
    </div>
  );
}

export function BigStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{ flex: "1 1 140px", padding: "16px 18px", borderRadius: 14, background: "rgba(var(--brand-rgb),0.05)", border: "1px solid var(--surface-border)" }}>
      <div style={{ fontSize: 28, fontWeight: 750, letterSpacing: "-0.02em", color: "var(--text-main)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

/** A section that's closed until asked for — details that would otherwise crowd the screen. */
export function Disclosure({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderRadius: 14, border: "1px solid var(--surface-border)", background: "var(--surface)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14.5, fontWeight: 650, color: "var(--text-main)" }}>{title}</span>
          {hint && <span style={{ display: "block", ...text.small, marginTop: 2 }}>{hint}</span>}
        </span>
        <ChevronDown size={18} color="var(--text-muted)" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
      </button>
      {open && <div style={{ padding: "0 20px 20px" }}>{children}</div>}
    </div>
  );
}

/** A friendly progress bar. */
export function ProgressBar({ percent, paused }: { percent: number; paused?: boolean }) {
  const p = Math.max(2, Math.min(100, percent));
  return (
    <div role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} style={{ height: 12, borderRadius: 999, background: "rgba(var(--brand-rgb),0.1)", overflow: "hidden" }}>
      <div
        style={{
          width: `${p}%`, height: "100%", borderRadius: 999, transition: "width 0.8s var(--ease-out)",
          background: paused ? tone.warn : "linear-gradient(90deg, var(--brand), var(--brand-light))",
          backgroundSize: "200% 100%", animation: paused ? "none" : "wiz-shimmer 2.4s linear infinite",
        }}
      />
      <style>{`@keyframes wiz-shimmer { from { background-position: 200% 0; } to { background-position: 0 0; } }`}</style>
    </div>
  );
}
