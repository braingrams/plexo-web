/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PLEXO THEME CONFIGURATION
 *  Single source of truth for all design tokens.
 *
 *  To swap the brand / palette tomorrow:
 *   1. Update BRAND below → all buttons, glows, active states follow.
 *   2. Update SURFACES if you want a lighter/different background family.
 *   3. Update FONTS to change typefaces (then also update layout.tsx imports).
 *   4. Run `npm run dev` — globals.css reads from CSS variables that mirror
 *      this file (keep them in sync — see the comment block inside globals.css).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ── Brand / Accent ─────────────────────────────────────── */
export const BRAND = {
  /** Primary accent — used for CTAs, active indicators, glows */
  500: "#8b5cf6",
  /** Darker shade — used for gradient endpoints & hover states */
  600: "#7c3aed",
  /** Even deeper — active / pressed */
  700: "#6d28d9",
  /** Lighter highlight */
  400: "#a78bfa",
  /** Very light tint */
  300: "#c084fc",

  // Semantic aliases
  primary:   "#8b5cf6",
  deep:      "#7c3aed",
  /** rgba glow for box-shadow etc. */
  glow:      "rgba(139, 92, 246, 0.35)",
  /** very transparent tint for backgrounds */
  subtle:    "rgba(139, 92, 246, 0.10)",
  subtleBorder: "rgba(139, 92, 246, 0.20)",
} as const;

/* ── Surfaces / Backgrounds ─────────────────────────────── */
export const SURFACES = {
  /** Page background */
  bg:       "#08090f",
  /** Card / panel level 1 */
  panel1:   "#0d0f1a",
  /** Card / panel level 2 */
  panel2:   "#121524",
  /** Card / panel level 3 */
  panel3:   "#181c2e",

  /** Glass surface fill */
  glass:    "rgba(255, 255, 255, 0.04)",
  /** Glass border */
  border:   "rgba(255, 255, 255, 0.08)",
  /** Glass hover fill */
  hover:    "rgba(255, 255, 255, 0.07)",
} as const;

/* ── Text ───────────────────────────────────────────────── */
export const TEXT = {
  /** Primary text */
  main:     "#f0f2ff",
  /** Secondary / labels */
  muted:    "#7b83a6",
  /** Faint / placeholders */
  faint:    "#4a5068",
} as const;

/* ── Semantic Colours ───────────────────────────────────── */
export const SEMANTIC = {
  danger:   "#f87171",
  success:  "#34d399",
  warning:  "#f59e0b",
  info:     "#38bdf8",
  indigo:   "#818cf8",
  violet:   "#c084fc",
} as const;

/* ── Typography ─────────────────────────────────────────── */
export const FONTS = {
  /**
   * Heading font — imported in layout.tsx via the `geist` package (geist/font/sans).
   * Change here AND update the import in layout.tsx.
   */
  heading: "Geist",
  /**
   * Body / UI font — imported in layout.tsx via the `geist` package (geist/font/sans).
   * Change here AND update the import in layout.tsx.
   */
  body:    "Geist",
} as const;

/* ── Border Radius ──────────────────────────────────────── */
export const RADIUS = {
  sm:   6,
  md:   10,
  lg:   14,
  xl:   20,
  full: 9999,
} as const;

/* ── Logo / Brand Identity ──────────────────────────────── */
export const LOGO = {
  /** Favicon / logo mark gradient — matches the shield icon */
  gradient:  `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})`,
  /** Glow for the logo mark */
  markGlow:  `0 0 20px ${BRAND.glow}`,
  /** App name displayed next to the mark */
  appName:   "Plexo",
} as const;

/* ── Modern (2026) layout mode tokens ───────────────────
 *  Used only when the dashboard is switched to "Modern" via
 *  the Profile page. Brand colours are intentionally shared
 *  with Classic (BRAND.* above) — only shape/depth changes.
 */
export const MODERN = {
  radius: {
    md: 16,
    lg: 24,
    xl: 28,
  },
  shadow: {
    card: "0 24px 60px -16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)",
    cardHover: "0 30px 70px -14px rgba(139,92,246,0.28), 0 0 0 1px rgba(139,92,246,0.18)",
    pill: "0 12px 32px -8px rgba(0,0,0,0.55)",
  },
  surface: {
    fill: "rgba(255, 255, 255, 0.045)",
    fillHover: "rgba(255, 255, 255, 0.07)",
    border: "rgba(255, 255, 255, 0.09)",
  },
  spacing: {
    cardPad: "2rem",
    gap: "1.5rem",
  },
} as const;

/* ── Convenience: inline-style objects ─────────────────── */

/** Brand-500 gradient button style (inline, for elements that can't use CSS classes) */
export const STYLE_BTN_BRAND = {
  background: LOGO.gradient,
  color:      "#fff",
  border:     "none",
  boxShadow:  `0 4px 20px ${BRAND.glow}`,
} as const;

/** Glass card surface */
export const STYLE_GLASS = {
  background: SURFACES.glass,
  border:     `1px solid ${SURFACES.border}`,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
} as const;

/* ── The whole site's CSS variables, generated from the values above ────────────────────────
 *  globals.css no longer holds colours. app/layout.tsx prints `themeCss()` into <head>, so changing BRAND / SURFACES / TEXT
 *  (or the light-mode values below) here changes every page, the editor, the emails and the site editors at once.
 *  Anything that can't read a CSS variable (emails, canvas, third-party props) imports these constants instead.
 */
const rgbOf = (hex: string): string => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ");
};
const alpha = (hex: string, a: number) => `rgba(${rgbOf(hex)}, ${a})`;

/** The brand in dark mode (the default) and light mode. `soft` is the pale tint used in gradients and highlights. */
export const BRAND_MODES = {
  dark: { primary: BRAND.primary, deep: BRAND.deep, deeper: BRAND[700], light: BRAND[300], soft: BRAND[400] },
  light: { primary: "#7c3aed", deep: "#6d28d9", deeper: "#5b21b6", light: "#a855f7", soft: "#8b5cf6" },
} as const;

export const SURFACES_LIGHT = { bg: "#ffffff", panel1: "#f5f5f7", panel2: "#eceef2", ink: "#0b0d12" } as const;
export const TEXT_LIGHT = { main: "#0b0d12", muted: "#55596b", faint: "#9297ab" } as const;

/** What the new page editor (the SDK) is told: the lime-on-black it ships with becomes Plexo purple on Plexo's background. */
export const EDITOR_THEME = { accent: BRAND.primary, background: SURFACES.bg, text: TEXT.main } as const;

/** Email palette: emails can't use CSS variables, so they read these. Brand colours are the dark-mode ones (they sit on white). */
export const EMAIL_COLORS: { brand: string; brandDeep: string; brandTint: string; ink: string } = { brand: BRAND_MODES.light.primary, brandDeep: BRAND_MODES.light.deep, brandTint: "#ede9fe", ink: SURFACES_LIGHT.ink };

function modeBlock(selector: string, b: (typeof BRAND_MODES)[keyof typeof BRAND_MODES], s: { bg: string; bg1: string; bg2: string; bg3: string; surface: string; border: string }, t: { main: string; muted: string; faint: string }, extra: string): string {
  return `${selector}{
  --brand:${b.primary};--brand-deep:${b.deep};--brand-deeper:${b.deeper};--brand-light:${b.light};--brand-soft:${b.soft};
  --brand-300:${b.light};--brand-400:${b.soft};--brand-500:${b.primary};--brand-600:${b.deep};--brand-700:${b.deeper};
  --brand-rgb:${rgbOf(b.primary)};--brand-deep-rgb:${rgbOf(b.deep)};--brand-light-rgb:${rgbOf(b.light)};
  --brand-glow:${alpha(b.primary, extra === "dark" ? 0.35 : 0.18)};--brand-subtle:${alpha(b.primary, extra === "dark" ? 0.1 : 0.08)};
  --bg:${s.bg};--bg-1:${s.bg1};--bg-2:${s.bg2};--bg-3:${s.bg3};--surface:${s.surface};--surface-border:${s.border};
  --text-main:${t.main};--text-muted:${t.muted};--text-faint:${t.faint};
  ${extra === "dark"
    ? `--shadow-card:inset 0 1px 0 rgba(255,255,255,0.08),0 20px 40px rgba(0,0,0,0.35);
  --body-bg-image:radial-gradient(ellipse 1200px 800px at 50% -200px,${alpha(b.primary, 0.15)} 0%,rgba(129,140,248,0.05) 40%,transparent 80%);
  --gradient-text:linear-gradient(135deg,#ffffff 0%,#cbd5e1 45%,${b.soft} 75%,#38bdf8 100%);`
    : `--shadow-card:0 1px 2px rgba(11,13,18,0.04),0 20px 40px rgba(11,13,18,0.08);
  --body-bg-image:radial-gradient(ellipse 900px 500px at 50% -100px,${alpha(b.primary, 0.05)} 0%,transparent 70%);
  --gradient-text:linear-gradient(135deg,${t.main} 0%,#3f3f52 45%,${b.primary} 75%,#0ea5e9 100%);`}
}`;
}

/** The `:root.dark` and `:root.light` variable blocks, as one stylesheet string. */
export function themeCss(): string {
  return [
    modeBlock(":root.dark", BRAND_MODES.dark, { bg: SURFACES.bg, bg1: SURFACES.panel1, bg2: SURFACES.panel2, bg3: SURFACES.panel3, surface: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)" }, { main: TEXT.main, muted: "#8b92b3", faint: TEXT.faint }, "dark"),
    modeBlock(":root.light", BRAND_MODES.light, { bg: SURFACES_LIGHT.bg, bg1: SURFACES_LIGHT.panel1, bg2: SURFACES_LIGHT.panel2, bg3: SURFACES_LIGHT.panel2, surface: "rgba(11,13,18,0.03)", border: "rgba(11,13,18,0.08)" }, TEXT_LIGHT, "light"),
  ].join("\n");
}
