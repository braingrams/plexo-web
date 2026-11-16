export type PlexoLogoProps = {
  /**
   * "auto" follows the theme (swapped with CSS, so there is no flash). "onLight" is the wordmark
   * for light backgrounds and "onDark" the one for dark backgrounds, whatever the theme.
   */
  variant?: "auto" | "onLight" | "onDark";
  /** Just the "p" mark (the app icon tile, readable on light and dark), no letters. */
  markOnly?: boolean;
  height?: number;
  className?: string;
  /** Read out by screen readers. Pass "" when a visible name sits next to it. */
  title?: string;
};

const BASE = "/api/brand/logo";

/**
 * The Plexo logo, served live from the Plexo project in Strata through our own stable URL
 * (app/api/brand/logo/[kind]). Replace the logo in Strata and this follows, with no deploy.
 * The wordmark is 124:32, the app icon a square.
 */
export function PlexoLogo({ variant = "auto", markOnly, height = 28, className, title = "Plexo" }: PlexoLogoProps) {
  const alt = title || "";
  const common = { height, alt, decoding: "async" as const, style: { flexShrink: 0, display: "block", height, width: "auto" } };
  if (markOnly) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={`${BASE}/app-icon`} width={height} {...common} />;
  }
  const width = Math.round((height * 124) / 32);
  const cls = (extra: string) => [className, extra].filter(Boolean).join(" ");
  if (variant === "onLight") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={`${BASE}/wordmark-on-light`} width={width} {...common} />;
  }
  if (variant === "onDark") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={`${BASE}/wordmark-on-dark`} width={width} {...common} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={cls("plx-logo-on-light")} src={`${BASE}/wordmark-on-light`} width={width} {...common} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={cls("plx-logo-on-dark")} src={`${BASE}/wordmark-on-dark`} width={width} {...common} alt="" />
    </>
  );
}
