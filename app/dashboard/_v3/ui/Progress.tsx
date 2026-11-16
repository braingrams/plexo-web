import { cx } from "./cx";

/** A progress bar with a plain label ("2 of 6 done"). */
export function ProgressBar({ value, max = 100, label, showLabel = true, thin, className }: { value: number; max?: number; label?: string; showLabel?: boolean; thin?: boolean; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const text = label ?? `${pct}%`;
  return (
    <div className={cx("plx-progress", thin && "plx-progress--thin", className)}>
      <div className="plx-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={text} aria-label={showLabel ? undefined : text}>
        <div className="plx-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      {showLabel ? <span className="plx-progress__label" aria-hidden>{text}</span> : null}
    </div>
  );
}

/** "Step 2 of 5" with a segmented bar — the onboarding header. `current` is 0-based. */
export function Stepper({ total, current, label, className }: { total: number; current: number; label?: string; className?: string }) {
  const text = label ?? `Step ${current + 1} of ${total}`;
  return (
    <div className={cx("plx-stepper", className)}>
      <span className="plx-stepper__label">{text}</span>
      <div className="plx-stepper__dots" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1} aria-valuetext={text}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="plx-stepper__dot" data-state={i < current ? "done" : i === current ? "current" : "upcoming"} />
        ))}
      </div>
    </div>
  );
}
