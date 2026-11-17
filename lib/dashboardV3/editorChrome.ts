import { siteHubHref } from "./hubPaths";

/**
 * Pure helpers for the site editors' frame: where "back" goes and how Plexo's own colours
 * (CSS variables read live from Strata) become the plain hex values the page editor needs.
 */

/** Leaving an editor: V3 owners go to the site's hub, everyone else keeps the old Details page. */
export function editorBackHref(v3: boolean, siteId: string): string {
  return v3 ? siteHubHref(siteId) : `/dashboard/templates/${siteId}/detail`;
}

/** Leaving an editor from a screen that has no site of its own (the old Templates list vs. the sites list). */
export function sitesListHref(v3: boolean): string {
  return v3 ? "/dashboard/sites" : "/dashboard/templates";
}

/** Leaving an app's editor: V3 owners go to that app's hub, everyone else to the apps list. */
export function appBackHref(v3: boolean, appId?: string | null): string {
  if (!v3) return "/dashboard/apps";
  return appId ? siteHubHref(appId) : "/dashboard/sites";
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number) => clamp(n).toString(16).padStart(2, "0");
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** `#rgb`, `#rrggbb`, `rgb()`, `rgba()` and `hsl()` (the forms Strata allows) → `#rrggbb`; anything else → null. */
export function cssColorToHex(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return `#${m[1].split("").map((c) => c + c).join("")}`;
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)\s*(?:[,/]\s*[\d.%]+\s*)?\)$/.exec(v);
  if (m) return toHex(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^hsla?\(\s*([\d.]+)(?:deg)?(?:\s*,\s*|\s+)([\d.]+)%(?:\s*,\s*|\s+)([\d.]+)%\s*(?:[,/]\s*[\d.%]+\s*)?\)$/.exec(v);
  if (m) {
    const [r, g, b] = hslToRgb(Number(m[1]) % 360, Number(m[2]) / 100, Number(m[3]) / 100);
    return toHex(r, g, b);
  }
  return null;
}

/** What the page editor is told about colour. All hex, because it mixes its own shades from them. */
export type EditorColors = { accent: string; onAccent: string; background: string; text: string; surface: string };

/**
 * Plexo's tokens (as the browser reports them) → the editor's colours. All five must be readable
 * colours, otherwise null and the editor keeps its own default look rather than a half-themed one.
 */
export function editorColorsFromTokens(tokens: { brand?: string | null; onBrand?: string | null; bg?: string | null; text?: string | null; surface?: string | null }): EditorColors | null {
  const accent = cssColorToHex(tokens.brand);
  const onAccent = cssColorToHex(tokens.onBrand);
  const background = cssColorToHex(tokens.bg);
  const text = cssColorToHex(tokens.text);
  const surface = cssColorToHex(tokens.surface);
  if (!accent || !onAccent || !background || !text || !surface) return null;
  return { accent, onAccent, background, text, surface };
}
