import { cx } from "./cx";

export type CardProps = React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "aside" | "li";
  padding?: "none" | "md" | "lg";
  tone?: "surface" | "tint" | "elevated";
  /** Hover lift — for cards that are themselves a link/button. */
  interactive?: boolean;
};

export function Card({ as: Tag = "div", padding = "md", tone = "surface", interactive, className, ...rest }: CardProps) {
  return (
    <Tag
      className={cx(
        "plx-card",
        padding === "md" && "plx-card--pad",
        padding === "lg" && "plx-card--pad-lg",
        tone === "tint" && "plx-card--tint",
        tone === "elevated" && "plx-card--elevated",
        interactive && "plx-card--interactive",
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ title, description, action, titleAs: H = "h2" }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; titleAs?: "h2" | "h3" }) {
  return (
    <div className="plx-card__header">
      <div>
        <H className="plx-card__title">{title}</H>
        {description ? <p className="plx-card__desc">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
