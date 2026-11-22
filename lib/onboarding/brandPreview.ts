/**
 * The owner's own brand on a design the moment they look at it, before SOL does anything:
 * their business name where the design has its sample name, and their chosen colour where the design has its accent.
 * Pure and browser-safe. The words and layout are never touched beyond the name, so it can't break a design.
 */
import { applyTextNodes, extractTextNodes } from "./htmlText";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function expand(hex: string): string {
  const h = hex.replace("#", "").toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join("") : h}`;
}

function toHsl(hex: string): [number, number, number] {
  const h = expand(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Black or white, whichever reads better on the colour (for text on a button of the brand colour). */
export function readableOnColor(hex: string): string {
  const h = expand(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111111" : "#ffffff";
}

/** The CSS that makes a compiled design use `color` as its brand colour (its own colour variables, plus the common aliases). */
export function brandColorCss(color: string): string | null {
  if (!HEX.test(color)) return null;
  const base = expand(color);
  const [h, s, l] = toHsl(base);
  const light = fromHsl([h, s, l + (1 - l) * 0.45]);
  const dark = fromHsl([h, s, l * 0.66]);
  const on = readableOnColor(base);
  return `:root{--color-brand-primary-500:${base};--color-brand-primary-300:${light};--color-brand-primary-700:${dark};--plx-accent:${base};--plx-on-accent:${on};--primary:${base};--brand:${base};--accent:${base};}`;
}

/** Colours a design writes directly as hex (`#e0b040`), most-used saturated one first: that is its accent. */
export function dominantAccent(html: string): string | null {
  const counts = new Map<string, number>();
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") + [...html.matchAll(/style="([^"]*)"/gi)].map((m) => m[1]).join("\n");
  for (const m of css.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = expand(m[0]);
    const [, s, l] = toHsl(hex);
    if (s < 0.45 || l < 0.25 || l > 0.8) continue; // greys, near-black and near-white are not an accent
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [hex, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = hex;
  return best;
}

/** The name the design uses for its sample business: the part of the design's name before a ":" or dash ("Iron & Grain: strength gym" → "Iron & Grain"). */
export function sampleBrandName(designName: string | undefined): string | null {
  const first = (designName ?? "").split(/\s*[:|–—]\s*|\s+-\s+/)[0].trim();
  return first.length >= 3 && first.length <= 40 ? first : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Puts the owner's name wherever the design says its sample business name (keeping ALL CAPS where the design shouts it). */
export function swapBrandName(html: string, sample: string, name: string): string {
  const re = new RegExp(escapeRe(sample), "gi");
  const replacements: Record<string, string> = {};
  for (const node of extractTextNodes(html)) {
    if (!re.test(node.text)) continue;
    re.lastIndex = 0;
    replacements[String(node.id)] = node.text.replace(re, (hit) => (hit === hit.toUpperCase() && /[A-Z]/.test(hit) ? name.toUpperCase() : name));
  }
  return Object.keys(replacements).length ? applyTextNodes(html, replacements) : html;
}

export type BrandPreviewInput = { name?: string; color?: string; designName?: string };

/** The design with the owner's name and colour on it. Anything missing or unusable is simply left as the design has it. */
export function brandPreviewHtml(html: string, input: BrandPreviewInput): string {
  let out = html;
  const name = input.name?.trim();
  const sample = sampleBrandName(input.designName);
  if (name && sample && name.toLowerCase() !== sample.toLowerCase()) out = swapBrandName(out, sample, name.slice(0, 60));

  const color = input.color && HEX.test(input.color) ? expand(input.color) : null;
  if (color) {
    // A design built on brand variables follows the variables; one with colours written straight in gets its main accent swapped.
    if (!/--color-brand-primary-500/.test(out)) {
      const accent = dominantAccent(out);
      if (accent && accent !== color) out = out.replace(new RegExp(escapeRe(accent), "gi"), color);
    }
    const css = brandColorCss(color);
    if (css) out = out.includes("</head>") ? out.replace("</head>", `<style data-plx-brand-preview="true">${css}</style></head>`) : `<style data-plx-brand-preview="true">${css}</style>${out}`;
  }
  return out;
}
