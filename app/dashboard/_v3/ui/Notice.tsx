"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

export type NoticeKind = "info" | "success" | "warning" | "error";

export type NoticeAction = { label: string; href?: string; onClick?: () => void; busy?: boolean };

const ICONS: Record<NoticeKind, LucideIcon> = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: OctagonAlert };

/**
 * The one banner for the v3 shell: sits inside the page column (same padding and width as the page),
 * with an icon, a title and one line, an optional action and a close button that is easy to hit.
 * Colours are tokens only, so it reads clearly in light and dark.
 */
export function Notice({
  kind = "info",
  icon,
  title,
  children,
  progress,
  action,
  onDismiss,
  className,
}: {
  kind?: NoticeKind;
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
  /** 0 to 1: a thin bar under the text. */
  progress?: number;
  action?: NoticeAction;
  onDismiss?: () => void;
  className?: string;
}) {
  const Icon = icon ?? ICONS[kind];
  const busy = action?.busy;
  return (
    <div role={kind === "error" || kind === "warning" ? "alert" : "status"} className={cx("plx-notice", `plx-notice--${kind}`, className)}>
      <span className="plx-notice__icon" aria-hidden>
        <Icon size={20} strokeWidth={2.2} />
      </span>
      <div className="plx-notice__body">
        <p className="plx-notice__title">{title}</p>
        {children ? <p className="plx-notice__text">{children}</p> : null}
        {typeof progress === "number" ? (
          <div className="plx-notice__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Progress">
            <div style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
          </div>
        ) : null}
      </div>
      {action ? (
        action.href ? (
          <Link href={action.href} className="plx-btn plx-btn--secondary plx-btn--sm plx-notice__action">
            {action.label}
          </Link>
        ) : (
          <button type="button" className="plx-btn plx-btn--secondary plx-btn--sm plx-notice__action" onClick={action.onClick} disabled={busy}>
            {busy ? "One moment…" : action.label}
          </button>
        )
      ) : null}
      {onDismiss ? (
        <button type="button" className="plx-notice__close" onClick={onDismiss} aria-label="Close this message">
          <X size={18} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** Several notices stacked with even spacing. */
export function NoticeStack({ children }: { children: React.ReactNode }) {
  return <div className="plx-notices">{children}</div>;
}
