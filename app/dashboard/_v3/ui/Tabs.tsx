"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { cx } from "./cx";
import { LinkPending } from "./LinkPending";

export type TabItem = { id: string; label: React.ReactNode; icon?: React.ReactNode; content: React.ReactNode };

/** In-page tabs (arrow keys move between them, per the ARIA tabs pattern). */
export function Tabs({ items, value, defaultValue, onChange, label, className }: { items: TabItem[]; value?: string; defaultValue?: string; onChange?: (id: string) => void; label: string; className?: string }) {
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id);
  const active = value ?? inner;
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = items.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(items[to].id);
    refs.current[items[to].id]?.focus();
  };
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="plx-tabs__list">
        {items.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            className="plx-tabs__tab"
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {items.map((t) =>
        t.id === active ? (
          <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} className="plx-tabs__panel" tabIndex={0}>
            {t.content}
          </div>
        ) : null,
      )}
    </div>
  );
}

/** Tabs that are pages (e.g. a site's Pages · Products · Orders): real links, the current one marked. */
export function TabLinks({ items, current, label, className, prefetch }: { items: { href: string; label: React.ReactNode; icon?: React.ReactNode; tour?: string }[]; current: string; label: string; className?: string; prefetch?: boolean }) {
  return (
    <nav aria-label={label} className={cx("plx-tabs__list", className)}>
      {items.map((t) => (
        <Link key={t.href} href={t.href} prefetch={prefetch} className="plx-tabs__tab" aria-current={t.href === current ? "page" : undefined} data-tour={t.tour}>
          {t.icon}
          {t.label}
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}
