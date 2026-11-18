/**
 * Emails are built by sync functions that read the shared EMAIL_COLORS object, so the live brand
 * reaches them by updating that object in place (last-known-good: bundled colours until the first
 * successful read, then whatever Strata last published). Logos need none of this, they are
 * stable proxy URLs (lib/mail/maildrip.ts EMAIL_LOGO).
 */
import type { BrandTokens } from "@/lib/brandTokens";
import { EMAIL_COLORS, EMAIL_COLORS_DEFAULT } from "@/lib/theme";
import { isSafeColor, parseColor } from "./strataTokens";

function tintOf(color: string): string {
  const rgb = parseColor(color);
  if (!rgb) return EMAIL_COLORS_DEFAULT.brandTint;
  const h = rgb.map((c) => Math.round(c * 0.14 + 255 * 0.86).toString(16).padStart(2, "0")).join("");
  return `#${h.toUpperCase()}`;
}

export function emailColorsFromTokens(tokens: BrandTokens): typeof EMAIL_COLORS {
  const t = tokens.light;
  const pick = (k: string, d: string) => (isSafeColor(t[k]) && !t[k].startsWith("color-mix") ? t[k] : d);
  const D = EMAIL_COLORS_DEFAULT;
  const brand = pick("color-action-primary-bg", D.brand);
  const on = t["color-action-primary-text"];
  return {
    brand,
    brandDeep: pick("color-brand-deep", D.brandDeep),
    // Never #121212 itself: the dark-mode rules would swap it to light text on the button.
    onBrand: on ? (on.toUpperCase() === "#121212" ? D.onBrand : on) : D.onBrand,
    brandTint: brand.toLowerCase() === D.brand.toLowerCase() ? D.brandTint : tintOf(brand),
    ink: pick("color-text-primary", D.ink),
    muted: pick("color-text-secondary", D.muted),
    border: pick("color-border-default", D.border),
    canvas: pick("color-bg-canvas", D.canvas),
    elevated: pick("color-bg-elevated", D.elevated),
    amber: pick("color-brand-accent", D.amber),
  };
}

export function applyEmailBrand(tokens: BrandTokens): void {
  Object.assign(EMAIL_COLORS, emailColorsFromTokens(tokens));
}
