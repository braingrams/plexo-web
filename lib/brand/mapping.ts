import postcss from "postcss";
import { extractColorNodes, type ExternalStylesheet } from "@/lib/htmlColorExtraction";

// "Use my brand on this site" for a raw-HTML upload or a WordPress-migrated site. Those pages were never built with brand
// variables, so the site's OWN dominant colours and fonts are matched to brand roles once (on import, and on "Apply my
// brand"), and at serve time every matching literal in the site's CSS is rewritten to `var(--token, <original>)`:
//   - with a brand linked, the hosted brand sheet defines --token, so the Strata brand shows;
//   - without one (or if the sheet can't load), the original value is the fallback, so the site looks exactly as it did.
// The stored pages and files are never changed — the rewrite happens on the way out — so switching it off is instant and
// lossless.

export type BrandMapping = {
  /** Normalised colour literal ("#1a73e8", "rgb(26,115,232)") -> token key. */
  colors: Record<string, string>;
  /** Lower-case font family name -> token key. */
  fonts: Record<string, string>;
};

const COLOR_PROPS = new Set(["color", "background-color", "background", "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color", "fill", "stroke"]);
const MAX_COLOR_ROLES = 6;

// ------------------------------------------------------------------------------------------------ colour helpers
function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace("#", "").toLowerCase();
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbOf(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) return hexToRgb(v);
  const m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) < (m[4].endsWith("%") ? 100 : 1)) return null; // see-through: not a brand colour
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}

/** The form colours are compared in: lower-case 6-digit hex where possible (#FFF, #ffffff and rgb(255,255,255) are one colour). */
export function normalizeColor(value: string): string {
  const rgb = rgbOf(value);
  if (!rgb) return value.trim().toLowerCase().replace(/\s+/g, "");
  return `#${rgb.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("")}`;
}

function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}
const lightness = ([r, g, b]: [number, number, number]): number => (Math.max(r, g, b) + Math.min(r, g, b)) / 510;

// ------------------------------------------------------------------------------------------------ working out the mapping
type Usage = { value: string; total: number; text: number; fill: number };

function fontUsage(html: string, sheets: ExternalStylesheet[]): { heading: Map<string, number>; body: Map<string, number> } {
  const heading = new Map<string, number>();
  const body = new Map<string, number>();
  const cssTexts = [...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]), ...sheets.map((s) => s.content)];
  for (const css of cssTexts) {
    let root;
    try {
      root = postcss.parse(css);
    } catch {
      continue;
    }
    root.walkDecls(/^font(-family)?$/i, (decl) => {
      const family = primaryFontFamily(decl.prop.toLowerCase() === "font" ? decl.value.split(/\s(?=["'A-Za-z][^,]*,|["'][^"']+["']\s*$)/).pop() ?? "" : decl.value);
      if (!family) return;
      const selector = decl.parent && "selector" in decl.parent ? String((decl.parent as { selector: string }).selector) : "";
      const target = /(^|[\s,>+~])h[1-6]\b|title|heading|headline/i.test(selector) ? heading : body;
      target.set(family, (target.get(family) ?? 0) + 1);
    });
  }
  return { heading, body };
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "inherit", "initial", "unset", "-apple-system", "blinkmacsystemfont", "ui-sans-serif", "ui-serif", "ui-monospace"]);
/** "'Open Sans', Arial, sans-serif" -> "open sans"; null for a var(), a generic family or an icon font. */
export function primaryFontFamily(value: string): string | null {
  if (/var\(/i.test(value)) return null;
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "").trim().toLowerCase();
  if (!first || GENERIC.has(first) || /icon|awesome|dashicons|glyph|eicons|fontello/i.test(first) || !/^[a-z0-9][a-z0-9 _-]{0,63}$/.test(first)) return null;
  return first;
}

const top = (m: Map<string, number>): string | undefined => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

/**
 * The site's colours and fonts, matched to brand roles:
 *   most-used text colour -> --color-text-primary, most-used plain background -> --color-bg-canvas,
 *   the two most-used saturated colours -> brand primary / secondary (and the primary also as the button fill),
 *   heading font -> --font-family-heading, body font -> --font-family-body.
 * Only confident matches are made; anything else is left alone.
 */
export function computeBrandMapping(html: string, sheets: ExternalStylesheet[] = []): BrandMapping {
  const usage = new Map<string, Usage>();
  for (const node of extractColorNodes(html, sheets)) {
    const key = normalizeColor(node.value);
    if (!rgbOf(key)) continue;
    const u = usage.get(key) ?? { value: key, total: 0, text: 0, fill: 0 };
    u.total += node.occurrences.length;
    usage.set(key, u);
  }
  // Which property each colour is used for: text vs fill. Counted from the CSS directly (extractColorNodes groups by value).
  const cssTexts = [...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]), ...sheets.map((s) => s.content), ...[...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => `x{${m[1]}}`)];
  for (const css of cssTexts) {
    let root;
    try {
      root = postcss.parse(css);
    } catch {
      continue;
    }
    root.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (!COLOR_PROPS.has(prop)) return;
      const u = usage.get(normalizeColor(decl.value));
      if (!u) return;
      if (prop === "color") u.text += 1;
      else if (prop === "background" || prop === "background-color") u.fill += 1;
    });
  }

  const colors: Record<string, string> = {};
  const all = [...usage.values()].sort((a, b) => b.total - a.total);
  const rgb = (u: Usage) => rgbOf(u.value)!;
  const text = all.filter((u) => u.text > 0 && saturation(rgb(u)) < 0.25 && lightness(rgb(u)) < 0.4).sort((a, b) => b.text - a.text)[0];
  if (text) colors[text.value] = "--color-text-primary";
  const canvas = all.filter((u) => u.fill > 0 && saturation(rgb(u)) < 0.2 && lightness(rgb(u)) > 0.85).sort((a, b) => b.fill - a.fill)[0];
  if (canvas && !colors[canvas.value]) colors[canvas.value] = "--color-bg-canvas";
  const vivid = all.filter((u) => !colors[u.value] && saturation(rgb(u)) >= 0.35 && lightness(rgb(u)) > 0.12 && lightness(rgb(u)) < 0.88);
  const roles = ["--color-brand-primary-500", "--color-brand-secondary-500"];
  vivid.slice(0, roles.length).forEach((u, i) => (colors[u.value] = roles[i]));
  // Keep the map small and predictable.
  const limited = Object.fromEntries(Object.entries(colors).slice(0, MAX_COLOR_ROLES));

  const fonts: Record<string, string> = {};
  const { heading, body } = fontUsage(html, sheets);
  const bodyFont = top(body);
  const headingFont = top(heading);
  if (bodyFont) fonts[bodyFont] = "--font-family-body";
  if (headingFont && headingFont !== bodyFont) fonts[headingFont] = "--font-family-heading";
  return { colors: limited, fonts };
}

export const isEmptyMapping = (m: BrandMapping | null | undefined): boolean => !m || (Object.keys(m.colors ?? {}).length === 0 && Object.keys(m.fonts ?? {}).length === 0);

// ------------------------------------------------------------------------------------------------ applying it (serve time)
const TOKEN = /^--[A-Za-z0-9_-]{1,120}$/;
// Colour literals in a value: hex, rgb()/rgba() (no nested brackets), never inside an existing var() fallback we wrote.
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d{1,3}[\s,]+\d{1,3}[\s,]+\d{1,3}(?:[\s,/]+[\d.]+%?)?\s*\)/g;

// A page's background colour is only swapped where it is used AS a background, and its text colour only as text: white text on a
// button must not turn into the brand's page background. Brand colours go wherever they're used.
const BACKGROUND_PROPS = new Set(["background", "background-color"]);
function roleFits(token: string, prop: string): boolean {
  if (/^--color-bg-/.test(token)) return BACKGROUND_PROPS.has(prop);
  if (/^--color-text-/.test(token)) return prop === "color" || prop === "fill";
  return true;
}

// Always applied to the STORED original (never to its own output), so nothing is wrapped twice. A literal that is already a
// var() fallback becomes a nested fallback, which is still valid CSS.
function rewriteValue(prop: string, value: string, m: BrandMapping): string {
  if (COLOR_PROPS.has(prop) || prop === "border" || prop.startsWith("border-") || prop === "box-shadow" || prop === "outline") {
    return value.replace(COLOR_LITERAL, (lit) => {
      const token = m.colors[normalizeColor(lit)];
      return token && TOKEN.test(token) && roleFits(token, prop) ? `var(${token}, ${lit})` : lit;
    });
  }
  if (prop === "font-family") {
    const family = primaryFontFamily(value);
    const token = family ? m.fonts[family] : undefined;
    return token && TOKEN.test(token) ? `var(${token}, ${value.trim()})` : value;
  }
  return value;
}

/** A stylesheet with every mapped colour and font replaced by `var(--token, original)`. Returns the input untouched if it can't be read. */
export function applyBrandMappingToCss(css: string, mapping: BrandMapping): string {
  if (isEmptyMapping(mapping)) return css;
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return css;
  }
  let changed = false;
  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    if (prop.startsWith("--")) return; // the site's own custom properties: their uses are rewritten where they're defined below
    const next = rewriteValue(prop, decl.value, mapping);
    if (next !== decl.value) {
      decl.value = next;
      changed = true;
    }
  });
  // Custom properties that hold a mapped colour (`--theme-blue: #1a73e8`) are the most common way a theme is written:
  // rewriting their definitions moves every use at once.
  root.walkDecls(/^--/, (decl) => {
    const lit = decl.value.trim();
    const token = mapping.colors[normalizeColor(lit)];
    if (token && rgbOf(lit) && TOKEN.test(token) && decl.prop !== token && /^--color-brand-/.test(token)) {
      decl.value = `var(${token}, ${lit})`;
      changed = true;
    }
  });
  return changed ? root.toString() : css;
}

/** A page with its <style> blocks and style="" attributes rewritten. Scripts are never touched. */
export function applyBrandMappingToHtml(html: string, mapping: BrandMapping): string {
  if (isEmptyMapping(mapping)) return html;
  let out = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_all, open: string, css: string, close: string) => `${open}${applyBrandMappingToCss(css, mapping)}${close}`);
  out = out.replace(/(\sstyle\s*=\s*")([^"]*)(")/gi, (all, pre: string, decls: string, post: string) => {
    if (!decls.trim()) return all;
    const css = applyBrandMappingToCss(`x{${decls.replace(/&quot;/g, '"')}}`, mapping);
    const inner = /^x\{([\s\S]*)\}$/.exec(css)?.[1];
    return inner === undefined ? all : `${pre}${inner.replace(/"/g, "&quot;")}${post}`;
  });
  return out;
}
