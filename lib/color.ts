/**
 * Small hex-color helpers for deriving a gradient/glow from a single org-supplied
 * brandColor (Organization.brandColor) — used anywhere white-label branding needs the
 * same "accent + deep + glow" triplet that lib/theme.ts's BRAND constant provides for the
 * default Plexo purple (dashboard shells, email CTAs).
 */

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([a-f\d]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Mixes a hex color toward black by `amount` (0-1) — used to derive a "deep" gradient stop. */
export function darken(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((c) => Math.round(c * (1 - amount)));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Renders a hex color as an rgba() string at the given alpha — used for glows/tints. */
export function toRgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** True if the string is a plausible 6-digit hex color (with or without leading #). */
export function isValidHexColor(hex: string): boolean {
  return parseHex(hex) !== null;
}
