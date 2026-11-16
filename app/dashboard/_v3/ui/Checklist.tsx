"use client";

import { useId } from "react";
import { Check, ChevronDown } from "lucide-react";
import { ProgressBar } from "./Progress";

export type TaskState = "done" | "current" | "upcoming";

export type TaskCardProps = {
  number: number;
  title: React.ReactNode;
  description?: React.ReactNode;
  state: TaskState;
  /** Whether the inline body is showing (the current task is usually open). */
  expanded?: boolean;
  onToggle?: () => void;
  /** The form or choices that finish this task, right here — no trip to another page. */
  children?: React.ReactNode;
  /** Small things on the right: a "Watch how" link, a "Change" button for done tasks. */
  aside?: React.ReactNode;
  tour?: string;
};

/** One guided task. Done = ticked; current = highlighted and open; upcoming = numbered. */
export function TaskCard({ number, title, description, state, expanded, onToggle, children, aside, tour }: TaskCardProps) {
  const bodyId = useId();
  const open = !!children && !!expanded;
  return (
    <li className="plx-task" data-state={state} data-tour={tour}>
      <div className="plx-task__row">
        <button
          type="button"
          className="plx-task__toggle"
          onClick={onToggle}
          disabled={!onToggle || !children}
          aria-expanded={children ? open : undefined}
          aria-controls={children ? bodyId : undefined}
        >
          <span className="plx-task__mark" aria-hidden>
            {state === "done" ? <Check size={18} strokeWidth={3} /> : number}
          </span>
          <span className="plx-task__text">
            <span className="plx-task__title">
              {title}
              <span className="plx-sr-only">{state === "done" ? " (done)" : state === "current" ? " (next up)" : ""}</span>
            </span>
            {description ? <span className="plx-task__desc">{description}</span> : null}
          </span>
        </button>
        {aside || children ? (
          <div className="plx-task__aside">
            {aside}
            {children && onToggle && state !== "current" ? <ChevronDown size={18} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s", opacity: 0.6 }} /> : null}
          </div>
        ) : null}
      </div>
      {open ? (
        <div id={bodyId} className="plx-task__body">
          {children}
        </div>
      ) : null}
    </li>
  );
}

/** A list of TaskCards with "N of M done" on top. */
export function Checklist({ done, total, children, label = "Your next steps", showProgress = true }: { done: number; total: number; children: React.ReactNode; label?: string; showProgress?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {showProgress ? <ProgressBar value={done} max={total} label={`${done} of ${total} done`} /> : null}
      <ol className="plx-checklist" aria-label={label}>
        {children}
      </ol>
    </div>
  );
}
