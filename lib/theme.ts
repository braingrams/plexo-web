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
   * Heading font — imported in layout.tsx via next/font/google.
   * Change here AND update the import in layout.tsx.
   */
  heading: "Space Grotesk",
  /**
   * Body / UI font — imported in layout.tsx via next/font/google.
   * Change here AND update the import in layout.tsx.
   */
  body:    "Inter",
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
