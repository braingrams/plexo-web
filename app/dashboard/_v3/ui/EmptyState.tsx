import { Plus } from "lucide-react";
import { cx } from "./cx";

export type EmptyStateProps = {
  title: React.ReactNode;
  body?: React.ReactNode;
  /** The one thing to do next (a Button or ButtonLink). */
  action?: React.ReactNode;
  /** A picture of what they'll get. Defaults to a small drawing of pages. */
  illustration?: React.ReactNode;
  /** Centred, single column — for narrow panels. */
  compact?: boolean;
  className?: string;
};

export function EmptyState({ title, body, action, illustration, compact, className }: EmptyStateProps) {
  return (
    <div className={cx("plx-empty", compact && "plx-empty--compact", className)}>
      <div className="plx-empty__text">
        <h2 className="plx-h2">{title}</h2>
        {body ? <p className="plx-body">{body}</p> : null}
        {action ? <div className="plx-empty__action">{action}</div> : null}
      </div>
      {compact && !illustration ? null : <div className="plx-empty__art" aria-hidden>{illustration ?? <PagesIllustration />}</div>}
    </div>
  );
}

/** Default empty-state drawing: a page being made, drawn with tokens so it works in light and dark. */
export function PagesIllustration() {
  return (
    <div className="plx-art-pages">
      <span />
      <span />
      <i>
        <Plus size={22} strokeWidth={3} />
      </i>
    </div>
  );
}
