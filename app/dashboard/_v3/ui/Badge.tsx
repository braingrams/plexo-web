import { cx } from "./cx";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet";

export function Badge({ tone = "neutral", dot, className, style, children }: { tone?: BadgeTone; dot?: boolean; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <span className={cx("plx-badge", tone !== "neutral" && `plx-badge--${tone}`, className)} style={style}>
      {dot ? <span className="plx-badge__dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

export type SiteStatus = "live" | "draft" | "paused" | "attention";

const STATUS: Record<SiteStatus, { label: string; tone: BadgeTone }> = {
  live: { label: "Live", tone: "success" },
  draft: { label: "Draft", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
  attention: { label: "Needs a look", tone: "danger" },
};

/** "Live" / "Draft" etc. — the words a site owner uses, with a dot (pulsing when live). */
export function StatusPill({ status, label }: { status: SiteStatus; label?: string }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} dot className={status === "live" ? "plx-badge--live" : undefined}>
      {label ?? s.label}
    </Badge>
  );
}
