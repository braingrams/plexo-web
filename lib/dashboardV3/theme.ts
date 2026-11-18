/**
 * Light / Dark / System for the v3 dashboard (docs/redesign/SPEC.md "Theme"). The choice is
 * stored on the user (`themePreference`) and mirrored in a cookie so pages that render before
 * the user record is read — and the very first paint — already have it. "system" is resolved
 * by CSS (`prefers-color-scheme`, see lib/brandTokens.ts), so the server never guesses.
 */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"] as const;
export const THEME_COOKIE = "plexo-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export function parseThemePreference(value: unknown): ThemePreference | null {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value) ? (value as ThemePreference) : null;
}

/** The saved account choice wins (it follows the person across devices), then the cookie, then System. */
export function resolveThemePreference(input: { user?: string | null; cookie?: string | null }): ThemePreference {
  return parseThemePreference(input.user) ?? parseThemePreference(input.cookie) ?? DEFAULT_THEME_PREFERENCE;
}

/** What the screen actually shows for a preference, given the OS setting. */
export function effectiveTheme(preference: ThemePreference, systemPrefersDark: boolean): "light" | "dark" {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function themeCookieString(preference: ThemePreference): string {
  return `${THEME_COOKIE}=${preference}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}
