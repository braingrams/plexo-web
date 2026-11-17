"use client";

import "./migrate.css";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Check } from "lucide-react";
import { Badge, Button, ButtonLink, ProgressBar, cx } from "../ui";
import type { Issue, Stage } from "@/lib/wpMigration/moveView";
import { solHref } from "@/lib/wpMigration/moveView";

// Reusable pieces for the move screens (kept here, not in the shared UI kit).

/** The journey across the top: Find · Review · Move · Check · Go live. `current` is 0-based. */
export function Track({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="plx-track" aria-label={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}>
      {steps.map((s, i) => (
        <li key={s} className="plx-track__item" data-state={i < current ? "done" : i === current ? "current" : "todo"} aria-current={i === current ? "step" : undefined}>
          <span className="plx-track__bar" />
          <span className="plx-track__label">{i + 1}. {s}</span>
        </li>
      ))}
    </ol>
  );
}

/** One number with a plain label ("12 pages"). */
export function StatCard({ value, label, icon, tone }: { value: React.ReactNode; label: string; icon?: React.ReactNode; tone?: "warning" }) {
  return (
    <div className="plx-mvstat" data-tone={tone}>
      {icon ? <span className="plx-mvstat__icon" aria-hidden>{icon}</span> : null}
      <span className="plx-mvstat__num">{value}</span>
      <span className="plx-mvstat__label">{label}</span>
    </div>
  );
}

/** The stages of a move, top to bottom, each with its own percentage and count. */
export function VStepper({ stages, showPercent = true }: { stages: Stage[]; showPercent?: boolean }) {
  return (
    <ol className="plx-vstep">
      {stages.map((s, i) => (
        <li key={s.id} className="plx-vstep__item" data-state={s.state} aria-current={s.state === "active" ? "step" : undefined}>
          <span className="plx-vstep__dot" aria-hidden>
            {s.state === "done" ? <Check size={18} /> : s.state === "stopped" ? <AlertTriangle size={17} /> : <span className={s.state === "active" ? "plx-pulse" : undefined}>{i + 1}</span>}
          </span>
          <div className="plx-vstep__body">
            <div className="plx-vstep__title">
              <span>{s.title}</span>
              {showPercent && s.state !== "todo" ? <span className="plx-vstep__pct">{s.state === "done" ? "Done" : `${s.percent}%`}</span> : null}
            </div>
            {s.state === "active" || s.state === "stopped" ? <span className="plx-vstep__detail">{s.state === "stopped" ? "Stopped here" : s.doing}</span> : null}
            {s.detail && s.state !== "todo" ? <span className="plx-vstep__detail">{s.detail}</span> : null}
            {s.state === "active" ? <ProgressBar value={s.percent} thin showLabel={false} label={`${s.title} ${s.percent}%`} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** What needs a look: a plain reason and a one-click fix for each. */
export function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="plx-issues">
      {issues.map((i) => (
        <li key={i.id} className="plx-issue" data-severity={i.severity}>
          <span className="plx-issue__icon" aria-hidden><AlertTriangle size={20} /></span>
          <div>
            <p className="plx-issue__title">{i.title}</p>
            <p className="plx-issue__detail">{i.detail}</p>
            <div className="plx-issue__fix">
              {i.fix.kind === "link" ? (
                <ButtonLink href={i.fix.href} size="sm" variant="secondary">{i.fix.label}</ButtonLink>
              ) : (
                <ButtonLink href={solHref(i.fix.prompt)} size="sm" variant="secondary">{i.fix.label}</ButtonLink>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Note({ tone = "warning", title, children, action }: { tone?: "warning" | "bad" | "info" | "good"; title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  const Icon = tone === "good" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div className={cx("plx-note", tone !== "warning" && `plx-note--${tone}`)} role={tone === "bad" ? "alert" : undefined}>
      <Icon size={20} aria-hidden />
      <div className="plx-stack" style={{ gap: 6 }}>
        {title ? <b>{title}</b> : null}
        {children ? <div>{children}</div> : null}
        {action}
      </div>
    </div>
  );
}

/** A collapsed section with a plain title (native details, so it works without scripts). */
export function Disclosure({ title, hint, defaultOpen, children }: { title: string; hint?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="plx-disc" open={defaultOpen}>
      <summary>
        <span className="plx-disc__text"><b>{title}</b>{hint ? <span>{hint}</span> : null}</span>
        <ChevronDown size={20} className="plx-disc__chev" aria-hidden />
      </summary>
      <div className="plx-disc__body">{children}</div>
    </details>
  );
}

export { Badge, Button };
