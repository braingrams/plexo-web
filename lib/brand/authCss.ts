/**
 * The live Plexo brand as a stylesheet for the sign-in screens (app/auth/_kit, also used by the
 * trial page and course sign-up). AuthShell links it (app/api/brand/auth-css); it re-declares only
 * the variables auth-tokens.css defines, with enough specificity to win regardless of load order.
 * When the brand equals the bundled one the values are the same, so nothing changes visually.
 */
import { LIGHT_TOKENS } from "@/lib/brandTokens";
import { getPlexoBrand } from "./plexoBrand";

const MAP: Record<string, string> = {
  "color-bg-canvas": "color-bg-page",
  "color-bg-surface": "color-bg-surface",
  "color-bg-elevated": "color-bg-elevated",
  "color-border-default": "color-border-default",
  "color-border-strong": "color-border-strong",
  "color-text-primary": "color-text-primary",
  "color-text-secondary": "color-text-secondary",
  "color-text-link": "color-text-link",
  "color-action-primary-bg": "color-action-primary-bg",
  "color-action-primary-text": "color-action-primary-text",
  "color-action-primary-hover": "color-action-primary-hover",
  "color-action-primary-active": "color-action-primary-active",
  "color-focus-ring": "color-focus-ring",
  "radius-control": "radius-control",
  "radius-card": "radius-card",
};

const decl = (set: Record<string, string>, extra: Record<string, string> = {}) => {
  const out: Record<string, string> = { ...extra };
  for (const [from, to] of Object.entries(MAP)) if (set[from] && !/[;{}<>]/.test(set[from])) out[to] = set[from];
  return Object.entries(out).map(([k, v]) => `--${k}:${v};`).join("");
};

export async function plexoAuthCss(): Promise<string> {
  const { tokens } = await getPlexoBrand();
  const { light, dark } = tokens;
  const changed = (set: Record<string, string>) => !!set["color-action-primary-bg"] && set["color-action-primary-bg"].toLowerCase() !== LIGHT_TOKENS["color-action-primary-bg"].toLowerCase();
  // The brand panel's gradient is derived from the primary only when the primary is not the bundled lime.
  const lightExtra: Record<string, string> = {};
  if (changed(light)) {
    const p = light["color-action-primary-bg"];
    lightExtra["aside-bg"] = `linear-gradient(155deg, color-mix(in srgb, ${p} 40%, white) 0%, ${p} 48%, color-mix(in srgb, ${p} 78%, black) 100%)`;
    lightExtra["aside-text"] = light["color-action-primary-text"] ?? "";
    lightExtra["color-focus-glow"] = `color-mix(in srgb, ${p} 55%, transparent)`;
  }
  if (light["color-brand-deep"]) lightExtra["aside-accent"] = light["color-brand-deep"];
  if (light["color-brand-accent"]) lightExtra["aside-amber"] = light["color-brand-accent"];
  const darkExtra: Record<string, string> = {};
  if (dark["color-action-primary-bg"] && changed(dark)) darkExtra["aside-accent"] = dark["color-action-primary-bg"];
  const L = decl(light, lightExtra);
  const D = decl(dark, darkExtra);
  const font = light["font-family-base"] && !light["font-family-base"].includes("--font-v3-sans") ? `.ax-root.ax-root{font-family:${light["font-family-base"]};}` : "";
  const r = ":root .ax-root.ax-root";
  return [
    `${r}[data-ax-theme="light"]{${L}}`,
    `@media (prefers-color-scheme: light){${r}:not([data-ax-theme="dark"]){${L}}}`,
    `${r}[data-ax-theme="dark"]{${D}}`,
    `@media (prefers-color-scheme: dark){${r}:not([data-ax-theme="light"]){${D}}}`,
    font,
  ].join("\n");
}
