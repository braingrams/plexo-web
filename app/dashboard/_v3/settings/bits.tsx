"use client";

import "../hub/hub.css";
import "./settings.css";
import { useState } from "react";
import { Check, Copy, Info, type LucideIcon } from "lucide-react";
import { Button, Card, cx } from "../ui";
import { saveBarState } from "@/lib/dashboardV3/settingsSaveBar";
import { meterText, type Meter as MeterData } from "@/lib/dashboardV3/settingsUsage";

/** A value to copy, in a box with a Copy button (also used for the one-link AI cards). */
export function CopyBox({ value, label, wrap }: { value: string; label: string; wrap?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="plx-copybox" style={{ marginTop: 0 }}>
      <code aria-label={label} style={wrap ? undefined : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</code>
      <Button
        size="sm"
        variant="secondary"
        leftIcon={done ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** One setting you switch on or off, with a plain sentence under it. */
export function ToggleRow({ title, description, checked, disabled, onChange }: { title: string; description?: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="plx-switchrow" style={{ cursor: disabled ? "default" : "pointer" }}>
      <span className="plx-switchrow__text">
        <b>{title}</b>
        {description ? <span>{description}</span> : null}
      </span>
      <input type="checkbox" className="plx-switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * THE page template every Settings page uses: one H1 with a one-line purpose, then the main
 * column (the most important card first) beside an optional side card of help. Wide screens use
 * the room; narrow ones stack.
 */
export function SettingsPageShell({ title, purpose, action, aside, below, bar, children }: { title: string; purpose: React.ReactNode; action?: React.ReactNode; aside?: React.ReactNode; /** Full-width content under both columns (e.g. the plan cards, which need the room). */ below?: React.ReactNode; bar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="plx-sp">
      <header className="plx-sp__head">
        <div className="plx-sp__headtext">
          <h2 className="plx-h2 plx-sp__title">{title}</h2>
          <p>{purpose}</p>
        </div>
        {action}
      </header>
      <div className={cx("plx-sp__cols", !aside && "plx-sp__cols--solo")}>
        <div className="plx-sp__main">
          {children}
          {bar}
        </div>
        {aside ? <aside className="plx-sp__side" aria-label="Help">{aside}</aside> : null}
      </div>
      {below}
    </div>
  );
}
/** Kept so older callers keep compiling: a title and one line. */
export function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="plx-sp__head">
      <div className="plx-sp__headtext">
        <h2 className="plx-h2">{title}</h2>
        {children ? <p>{children}</p> : null}
      </div>
    </header>
  );
}

/** A titled card: H2, one quiet line, 28px padding. `flush` lets lists run edge to edge. */
export function Panel({ title, description, action, flush, tone, className, children, ...rest }: { title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; flush?: boolean; tone?: "surface" | "tint" | "elevated" } & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <Card as="section" padding="none" tone={tone} className={cx("plx-panel", flush && "plx-panel--flush", className)} {...rest}>
      {title ? (
        <div className="plx-panel__head">
          <div>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

/**
 * The side card: a real surface (border, accent edge, header icon) for live status and the few
 * tips that matter. Use `AsideStats` inside for live numbers, then short tips below.
 */
export function AsideCard({ title, icon: Icon = Info, children, style, className }: { title: string; icon?: LucideIcon; children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <Card as="section" padding="none" className={cx("plx-aside", className)} style={style}>
      <header className="plx-aside__head">
        <span className="plx-aside__icon" aria-hidden><Icon size={18} /></span>
        <h3>{title}</h3>
      </header>
      <div className="plx-aside__body" style={style ? { flex: 1, display: "flex", flexDirection: "column" } : undefined}>{children}</div>
    </Card>
  );
}

/** Live numbers for the side card: a big value over a short plain label. Pass `tone` to draw the eye. */
export function AsideStats({ items }: { items: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "bad" }[] }) {
  return (
    <dl className="plx-asidestats">
      {items.map((i) => (
        <div key={i.label} data-tone={i.tone}>
          <dd>{i.value}</dd>
          <dt>{i.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Title and helper on the left, the control on the right. */
export function SettingRow({ title, description, children }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="plx-srow">
      <div className="plx-srow__text">
        <b>{title}</b>
        {description ? <span>{description}</span> : null}
      </div>
      {children ? <div className="plx-srow__end">{children}</div> : null}
    </div>
  );
}

/** The red-edged card at the very bottom of a page: only for things that can't be undone. */
export function DangerCard({ title = "Danger zone", description, children }: { title?: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card as="section" padding="none" className="plx-danger" aria-label={title}>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {children}
    </Card>
  );
}

/** A usage meter: label, "2 of 4", a bar (amber near the limit, red when full) and one plain hint. */
export function UsageMeter({ label, meter, unit, hint }: { label: string; meter: MeterData; unit?: { one: string; many: string }; hint?: string }) {
  const text = meterText(meter, unit);
  return (
    <div className="plx-meter" data-tone={meter.tone}>
      <div className="plx-meter__top">
        <b>{label}</b>
        <span>{text}</span>
      </div>
      {meter.limit === null || meter.limit === 0 ? null : (
        <div className="plx-meter__bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={meter.limit} aria-valuenow={Math.min(meter.used, meter.limit)} aria-valuetext={text}>
          <div className="plx-meter__fill" style={{ width: `${Math.max(meter.used > 0 ? 3 : 0, meter.pct)}%` }} />
        </div>
      )}
      {hint ? <span className="plx-meter__hint">{hint}</span> : null}
    </div>
  );
}

/** "Save changes / Discard": appears only while something is changed, stays in view while you scroll. */
export function SaveBar({ dirty, saving, valid, onSave, onDiscard, message = "You have changes that aren't saved yet." }: { dirty: boolean; saving?: boolean; valid?: boolean; onSave: () => void; onDiscard: () => void; message?: string }) {
  const s = saveBarState({ dirty, saving, valid });
  if (!s.visible) return null;
  return (
    <div className="plx-savebar" role="region" aria-label="Unsaved changes" aria-live="polite">
      <span className="plx-savebar__text">{message}</span>
      <div className="plx-savebar__actions">
        <Button variant="ghost" disabled={!s.canDiscard} onClick={onDiscard}>Discard</Button>
        <Button loading={saving} disabled={!s.canSave} onClick={onSave}>Save changes</Button>
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad"; children: React.ReactNode }) {
  return (
    <div className={`plx-inlinemsg${tone === "warn" ? " plx-inlinemsg--warn" : tone === "bad" ? " plx-inlinemsg--bad" : ""}`} role={tone === "bad" ? "alert" : undefined}>
      {children}
    </div>
  );
}
