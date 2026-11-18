"use client";

import { useRef } from "react";
import { cx } from "./cx";

export type SegmentOption<T extends string> = { value: T; label: string; icon?: React.ReactNode; hideLabel?: boolean };

/** A small one-of-a-few switch (e.g. Light / Dark / System). Arrow keys move the choice. */
export function SegmentedControl<T extends string>({ options, value, onChange, label, className }: { options: SegmentOption<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const iconOnly = options.every((o) => o.hideLabel && o.icon);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = options.length;
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(options[to].value);
    refs.current[to]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx("plx-seg", iconOnly && "plx-seg--icon-only", className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.hideLabel ? o.label : undefined}
          title={o.hideLabel ? o.label : undefined}
          tabIndex={o.value === value ? 0 : -1}
          className="plx-seg__opt"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.icon}
          {o.hideLabel ? null : o.label}
        </button>
      ))}
    </div>
  );
}
