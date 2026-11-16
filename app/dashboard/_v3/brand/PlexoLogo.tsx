import { LOGO_MARK_INK, LOGO_MARK_SQUARE, LOGO_WORDMARK } from "./logoPaths";

export type PlexoLogoProps = {
  /**
   * "auto" follows the theme (letters in the current text colour). "onLight" is the dark
   * wordmark for light backgrounds and "onDark" the light one, whatever the theme.
   */
  variant?: "auto" | "onLight" | "onDark";
  /** Just the "p" mark (as in the favicon), no letters. */
  markOnly?: boolean;
  height?: number;
  className?: string;
  /** Read out by screen readers. Pass "" when a visible name sits next to it. */
  title?: string;
};

const INK: Record<NonNullable<PlexoLogoProps["variant"]>, string> = {
  auto: "currentColor",
  onLight: "var(--logo-ink-on-light)",
  onDark: "var(--logo-ink-on-dark)",
};

/** The Plexo logo, drawn from docs/redesign/logo-*.svg with token colours. */
export function PlexoLogo({ variant = "auto", markOnly, height = 28, className, title = "Plexo" }: PlexoLogoProps) {
  const vbW = markOnly ? 30 : 124;
  const ink = INK[variant];
  return (
    <svg
      className={className}
      height={height}
      width={Math.round((height * vbW) / 32)}
      viewBox={`0 0 ${vbW} 32`}
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      style={{ flexShrink: 0, display: "block" }}
    >
      <path d={LOGO_MARK_INK} fill={ink} />
      <path d={LOGO_MARK_SQUARE} fill="var(--logo-mark)" />
      {markOnly ? null : LOGO_WORDMARK.map((d, i) => <path key={i} d={d} fill={ink} />)}
    </svg>
  );
}
