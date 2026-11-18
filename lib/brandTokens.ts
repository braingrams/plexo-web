/**
 * The v3 dashboard's colour, radius and shadow tokens (docs/redesign/SPEC.md "Tokens").
 *
 * Names follow Strata (the Charisol design system) so a later step can read the Plexo brand
 * project's published tokens server-side and pass them straight to `brandTokensCss()` — a
 * Strata publish then restyles the app with no deploy. The sets below are the bundled
 * defaults and the fallback for any token Strata doesn't provide.
 *
 * Scope: every rule is keyed on `data-theme` (on <html> or on the v3 root wrapper), which the
 * old dashboard and the marketing site never set, so nothing here can leak into them. Their
 * own palette stays in lib/theme.ts until launch.
 *
 * v3 components never use colour literals: they read the `--plx-*` aliases at the bottom of
 * this file (or the Strata names directly). tests/v3NoColorLiterals.test.ts enforces it.
 */

export type ThemeName = "light" | "dark";

/** One mode's token values, keyed by Strata token name without the leading `--`. */
export type TokenSet = Record<string, string>;

export type BrandTokens = { light: TokenSet; dark: TokenSet };

/** Values shared by both modes (radii, shadows that read on either, type). */
export const SHARED_TOKENS: TokenSet = {
  "radius-control": "12px",
  "radius-card": "18px",
  "radius-card-lg": "22px",
  "radius-pill": "999px",
  "space-gutter": "32px",
  "control-height": "44px",
  // Strata's --font-family-base. The default points at the sans next/font loads for v3.
  "font-family-base": 'var(--font-v3-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  "font-weight-heading": "800",
  "letter-spacing-heading": "-0.02em",
  // The logo's letters on a light / dark background (docs/redesign/logo-dark.svg, logo-light.svg).
  "logo-ink-on-light": "#232323",
  "logo-ink-on-dark": "#F4F5F0",
  "logo-mark": "#B8F34A",
};

/*
 * Colour discipline: the lime brand colour is for the ONE main action on a screen (and a single highlight such
 * as today's bar or the progress fill). Links, active menu items, tinted cards and icon tiles stay neutral, so
 * nothing competes with it.
 */
export const LIGHT_TOKENS: TokenSet = {
  "color-bg-canvas": "#F7F8F3",
  "color-bg-surface": "#FFFFFF",
  "color-bg-elevated": "#F4F5F0",
  "color-bg-sunken": "#EEEFE9",
  "color-bg-tint": "#ECEDE6",
  "color-border-default": "#E8E8E4",
  "color-border-subtle": "#EFEFEB",
  "color-border-strong": "#CFCFC9",
  "color-text-primary": "#121212",
  "color-text-secondary": "#5B5B58",
  "color-text-muted": "#6B6B67",
  "color-text-link": "#121212",
  "color-text-inverse": "#F7F8F3",
  "color-brand-primary": "#B8F34A",
  "color-brand-deep": "#121212",
  "color-brand-accent": "#F5AC05",
  "color-brand-secondary": "#5545D6",
  "color-brand-secondary-subtle": "#EEECFF",
  "color-action-primary-bg": "#B8F34A",
  "color-action-primary-text": "#121212",
  "color-action-primary-hover": "#A7E536",
  "color-action-primary-active": "#96D426",
  "color-action-secondary-bg": "#FFFFFF",
  "color-action-secondary-text": "#121212",
  "color-action-secondary-border": "#DCDCD6",
  "color-action-secondary-hover": "#F4F5F0",
  "color-action-ghost-bg": "transparent",
  "color-action-ghost-text": "#121212",
  "color-action-ghost-hover": "#EEEFE9",
  "color-action-strong-bg": "#121212",
  "color-action-strong-text": "#F7F8F3",
  "color-status-success": "#3F6310",
  "color-status-success-subtle": "#E8F3D2",
  "color-status-warning": "#8A5A00",
  "color-status-warning-subtle": "#FDF0D2",
  "color-status-danger": "#B42318",
  "color-status-danger-subtle": "#FDE8E5",
  "color-action-danger-text": "#FFFFFF",
  "color-status-info": "#3B30A8",
  "color-status-info-subtle": "#EEECFF",
  "color-focus-ring": "#517A12",
  "color-overlay": "rgba(18, 18, 18, 0.45)",
  "color-spotlight": "rgba(18, 18, 18, 0.55)",
  "shadow-card": "0 1px 2px rgba(18, 18, 18, 0.04)",
  "shadow-raised": "0 10px 30px rgba(18, 18, 18, 0.08)",
  "shadow-overlay": "0 24px 60px rgba(18, 18, 18, 0.18)",
  "shadow-thumb": "0 1px 3px rgba(18, 18, 18, 0.14)",
};

export const DARK_TOKENS: TokenSet = {
  "color-bg-canvas": "#0B0B12",
  "color-bg-surface": "#15161C",
  "color-bg-elevated": "#1D1F26",
  "color-bg-sunken": "#101118",
  "color-bg-tint": "#23252D",
  "color-border-default": "#2C2E35",
  "color-border-subtle": "#22242B",
  "color-border-strong": "#3E414A",
  "color-text-primary": "#F4F5F0",
  "color-text-secondary": "#A6A7A2",
  "color-text-muted": "#8E8F8A",
  "color-text-link": "#F4F5F0",
  "color-text-inverse": "#121212",
  "color-brand-primary": "#B8F34A",
  "color-brand-deep": "#F4F5F0",
  "color-brand-accent": "#F5AC05",
  "color-brand-secondary": "#8A7BFF",
  "color-brand-secondary-subtle": "#22203A",
  "color-action-primary-bg": "#B8F34A",
  "color-action-primary-text": "#121212",
  "color-action-primary-hover": "#C6F76A",
  "color-action-primary-active": "#A7E536",
  "color-action-secondary-bg": "#15161C",
  "color-action-secondary-text": "#F4F5F0",
  "color-action-secondary-border": "#34363E",
  "color-action-secondary-hover": "#1D1F26",
  "color-action-ghost-bg": "transparent",
  "color-action-ghost-text": "#F4F5F0",
  "color-action-ghost-hover": "#1D1F26",
  "color-action-strong-bg": "#F4F5F0",
  "color-action-strong-text": "#121212",
  "color-status-success": "#B8F34A",
  "color-status-success-subtle": "#1F2614",
  "color-status-warning": "#F5C451",
  "color-status-warning-subtle": "#2B2312",
  "color-status-danger": "#FF8A7A",
  "color-status-danger-subtle": "#2E1716",
  "color-action-danger-text": "#121212",
  "color-status-info": "#A99FFF",
  "color-status-info-subtle": "#22203A",
  "color-focus-ring": "#B8F34A",
  "color-overlay": "rgba(0, 0, 0, 0.6)",
  "color-spotlight": "rgba(0, 0, 0, 0.66)",
  "shadow-card": "0 1px 2px rgba(0, 0, 0, 0.3)",
  "shadow-raised": "0 10px 30px rgba(0, 0, 0, 0.35)",
  "shadow-overlay": "0 24px 60px rgba(0, 0, 0, 0.55)",
  "shadow-thumb": "0 1px 3px rgba(0, 0, 0, 0.5)",
};

export const DEFAULT_BRAND_TOKENS: BrandTokens = { light: LIGHT_TOKENS, dark: DARK_TOKENS };

/**
 * Plexo's semantic aliases — what v3 components actually use. Each points at a Strata name, so
 * overriding the Strata token restyles every component that uses the alias.
 */
export const SEMANTIC_ALIASES: Record<string, string> = {
  "plx-bg": "color-bg-canvas",
  "plx-surface": "color-bg-surface",
  "plx-elevated": "color-bg-elevated",
  "plx-sunken": "color-bg-sunken",
  "plx-tint": "color-bg-tint",
  "plx-border": "color-border-default",
  "plx-border-subtle": "color-border-subtle",
  "plx-border-strong": "color-border-strong",
  "plx-text": "color-text-primary",
  "plx-muted": "color-text-secondary",
  "plx-faint": "color-text-muted",
  "plx-link": "color-text-link",
  "plx-inverse": "color-text-inverse",
  "plx-brand": "color-action-primary-bg",
  "plx-on-brand": "color-action-primary-text",
  "plx-brand-hover": "color-action-primary-hover",
  "plx-brand-active": "color-action-primary-active",
  "plx-deep": "color-brand-deep",
  "plx-accent": "color-brand-accent",
  "plx-violet": "color-brand-secondary",
  "plx-violet-subtle": "color-brand-secondary-subtle",
  "plx-secondary-bg": "color-action-secondary-bg",
  "plx-secondary-text": "color-action-secondary-text",
  "plx-secondary-border": "color-action-secondary-border",
  "plx-secondary-hover": "color-action-secondary-hover",
  "plx-ghost-hover": "color-action-ghost-hover",
  "plx-strong": "color-action-strong-bg",
  "plx-on-strong": "color-action-strong-text",
  "plx-success": "color-status-success",
  "plx-success-subtle": "color-status-success-subtle",
  "plx-warning": "color-status-warning",
  "plx-warning-subtle": "color-status-warning-subtle",
  "plx-danger": "color-status-danger",
  "plx-danger-subtle": "color-status-danger-subtle",
  "plx-on-danger": "color-action-danger-text",
  "plx-info": "color-status-info",
  "plx-info-subtle": "color-status-info-subtle",
  "plx-focus": "color-focus-ring",
  "plx-overlay": "color-overlay",
  "plx-spotlight": "color-spotlight",
  "plx-shadow-card": "shadow-card",
  "plx-shadow-raised": "shadow-raised",
  "plx-shadow-overlay": "shadow-overlay",
  "plx-shadow-thumb": "shadow-thumb",
  "plx-radius": "radius-control",
  "plx-radius-card": "radius-card",
  "plx-radius-card-lg": "radius-card-lg",
};

/** Only token names and values that can't break out of a CSS declaration are emitted. */
const SAFE_NAME = /^[a-z0-9-]{1,64}$/;
const SAFE_VALUE = /^[^;{}<>\\]{1,200}$/;

function declarations(set: TokenSet): string {
  return Object.entries(set)
    .filter(([name, value]) => SAFE_NAME.test(name) && typeof value === "string" && SAFE_VALUE.test(value.trim()))
    .map(([name, value]) => `--${name}:${value.trim()};`)
    .join("");
}

function block(selectors: string[], body: string): string {
  return `${selectors.join(",")}{${body}}`;
}

/** Selectors for one stored theme value, on <html> or on the v3 root wrapper. */
const themeSelectors = (value: "light" | "dark" | "system"): string[] => [`:root[data-theme="${value}"]`, `[data-plexo-v3][data-theme="${value}"]`];

/**
 * The full v3 token stylesheet. Pure: same input, same string — callers can pass live Strata
 * tokens merged over the defaults (`mergeBrandTokens`). "system" follows the OS setting with
 * CSS alone, so the server can render the right colours on the first paint with no script.
 */
export function brandTokensCss(tokens: BrandTokens = DEFAULT_BRAND_TOKENS): string {
  const light = { ...SHARED_TOKENS, ...LIGHT_TOKENS, ...tokens.light };
  const dark = { ...SHARED_TOKENS, ...DARK_TOKENS, ...tokens.dark };
  const aliases = Object.entries(SEMANTIC_ALIASES)
    .map(([alias, target]) => `--${alias}:var(--${target});`)
    .join("");
  const all = ["light", "dark", "system"] as const;
  return [
    block(all.flatMap(themeSelectors), aliases),
    block([...themeSelectors("light"), ...themeSelectors("system")], `color-scheme:light;${declarations(light)}`),
    block(themeSelectors("dark"), `color-scheme:dark;${declarations(dark)}`),
    `@media (prefers-color-scheme: dark){${block(themeSelectors("system"), `color-scheme:dark;${declarations(dark)}`)}}`,
  ].join("\n");
}

/** Overlay a partial token set (e.g. what Strata published) onto the bundled defaults. */
export function mergeBrandTokens(overrides?: Partial<{ light: TokenSet; dark: TokenSet }>): BrandTokens {
  return {
    light: { ...LIGHT_TOKENS, ...(overrides?.light ?? {}) },
    dark: { ...DARK_TOKENS, ...(overrides?.dark ?? {}) },
  };
}

const HEX = /^#([0-9a-f]{6})$/i;

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/**
 * A white-label organisation's brand colour as token overrides (both modes): their colour on
 * every main button, with whichever of near-black / near-white text reads better on it.
 * Hover/active are derived in CSS (color-mix) so any colour works. Invalid input → no overrides.
 */
export function orgBrandTokenOverrides(color: string | null | undefined): Partial<BrandTokens> {
  if (!color || !HEX.test(color.trim())) return {};
  const c = color.trim();
  const text = relativeLuminance(c) > 0.32 ? LIGHT_TOKENS["color-text-primary"] : DARK_TOKENS["color-text-primary"];
  const set: TokenSet = {
    "color-brand-primary": c,
    "color-action-primary-bg": c,
    "color-action-primary-text": text,
    "color-action-primary-hover": `color-mix(in srgb, ${c} 88%, ${text})`,
    "color-action-primary-active": `color-mix(in srgb, ${c} 78%, ${text})`,
  };
  return { light: set, dark: set };
}
