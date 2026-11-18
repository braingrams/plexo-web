import "./v3.css";

import { orgBrandTokenOverrides } from "@/lib/brandTokens";
import { plexoBrandTokensCss } from "@/lib/brand/plexoBrand";
import type { ThemePreference } from "@/lib/dashboardV3/theme";
import { v3Mono, v3Sans } from "./fonts";
import { V3ThemeRoot } from "./theme/ThemeContext";
import { ToastProvider } from "./ui/Toast";
import { PORTAL_ID } from "./ui/portal";

/**
 * Everything a v3 screen sits inside: the tokens (default + an org's white-label colour), the
 * fonts, the theme, toasts and the overlay layer. Used by the v3 dashboard layout, the
 * onboarding (/welcome/setup) and the dev preview. The Plexo brand (colours, font, radii) is read
 * live from Strata (lib/brand/plexoBrand), so a Strata publish restyles the app within ~60s; an
 * org's white-label colour still wins over it.
 */
export async function V3Root({ themePreference, brandColor, persistTheme = true, children }: { themePreference: ThemePreference; brandColor?: string | null; persistTheme?: boolean; children: React.ReactNode }) {
  const css = await plexoBrandTokensCss(orgBrandTokenOverrides(brandColor));
  return (
    <V3ThemeRoot initialPreference={themePreference} persist={persistTheme} className={`${v3Sans.variable} ${v3Mono.variable}`}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {/* Runs while the page is still being read, before anything is drawn: the page behind the app matches too. */}
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(themePreference)}` }} />
      <ToastProvider>{children}</ToastProvider>
      <div id={PORTAL_ID} />
    </V3ThemeRoot>
  );
}
