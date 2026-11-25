/**
 * The owner's own brand on a design the moment they look at it, before SOL does anything:
 * their business name where the design has its sample name, and their chosen colour where the design has its accent.
 * Pure and browser-safe. The words and layout are never touched beyond the name, so it can't break a design.
 */
import { applyTextNodes, decodeEntities, extractTextNodes } from "./htmlText";

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

/** The sample name as the page writes it: the whole name, or its first words ("Careline Home Nursing" is written "Careline" on the page). */
export function sampleNameOnPage(html: string, designName: string | undefined): string | null {
  const full = sampleBrandName(designName);
  if (!full) return null;
  const words = full.split(/\s+/);
  const texts = extractTextNodes(html).map((n) => n.text.toLowerCase());
  for (let n = words.length; n >= 1; n--) {
    const candidate = words.slice(0, n).join(" ");
    if (candidate.length < 3) continue;
    if (n < words.length && /^(the|a|an|my|our|of|and)$/i.test(words[n - 1])) continue;
    const lower = candidate.toLowerCase();
    if (texts.some((t) => t.includes(lower))) return candidate;
  }
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every way the page writes its sample business name, longest first. Designs use the full name in a few places and a short
 * form ("Careline", "Harbour Mind", "Oakridge") everywhere else, so ALL of them have to be swapped or the owner keeps seeing
 * the template's name. The single first word is only used when it is clearly the brand and not a common word: a brand shows
 * up alone (a logo, a heading) or mid-sentence with a capital ("at Stackhouse"); a common word ("Still", "Little") only
 * ever starts a sentence.
 */
export function sampleNamesOnPage(html: string, designName: string | undefined): string[] {
  const full = sampleBrandName(designName);
  if (!full) return [];
  const nodes = extractTextNodes(html).map((n) => n.text);
  const words = full.split(/\s+/);
  const lowerAll = nodes.map((t) => t.toLowerCase());
  const found: string[] = [];
  for (let n = words.length; n >= 2; n--) {
    if (/^(the|a|an|my|our|of|and|&)$/i.test(words[n - 1])) continue;
    const candidate = words.slice(0, n).join(" ");
    if (lowerAll.some((t) => t.includes(candidate.toLowerCase()))) found.push(candidate);
  }
  const word = words[0].replace(/[^A-Za-z0-9\u00C0-\u024F'’-]/g, "");
  if (word.length >= 3 && !/^(the|a|an|my|our|of|and)$/i.test(word)) {
    // Look only at what is left once the longer forms are taken out, so "Little" in "Little Sprouts" does not count as a lone word.
    let rest = nodes;
    for (const f of found) rest = rest.map((t) => t.split(new RegExp(escapeRe(f), "gi")).join("\u0000"));
    const mid = new RegExp(`[a-z,;:)(] ${escapeRe(word)}(?![A-Za-z])`);
    const brandLike = rest.some((t) => t.trim().toLowerCase() === word.toLowerCase() || mid.test(t) || new RegExp(`(?<![A-Za-z])${escapeRe(word.toUpperCase())}(?![A-Za-z])`).test(t) && word.toUpperCase() !== word);
    // The design's own email or web address starts with it ("partners@marlowelaw.co.uk"): it is the brand.
    const inAddress = lowerAll.some((t) => new RegExp(`(@|www\\.)${escapeRe(word.toLowerCase())}`).test(t));
    if (brandLike || inAddress) found.push(word);
  }
  return Array.from(new Set(found)).sort((a, b) => b.length - a.length);
}

/** swapBrandName for one piece of text (a field of a design's JSON): the same rule for what counts as the sample name and for keeping ALL CAPS. */
export function swapNameInText(text: string, sample: string, name: string): string {
  const single = !/\s/.test(sample) && /[A-Z]/.test(sample);
  const re = single
    ? new RegExp(`(?<![A-Za-z])(?:${escapeRe(sample)}|${escapeRe(sample.toUpperCase())})(?![A-Za-z]|-[a-z])`, "g")
    : new RegExp(`(?<![A-Za-z])${escapeRe(sample)}(?![A-Za-z])`, "gi");
  return text.replace(re, (hit) => (hit === hit.toUpperCase() && /[A-Z]/.test(hit) ? name.toUpperCase() : name));
}

/** Puts the owner's name wherever the design says its sample business name (keeping ALL CAPS where the design shouts it). */
export function swapBrandName(html: string, sample: string, name: string): string {
  // A one-word name only counts as written or in capitals: "larch-wood floors" is not the brand "Larch".
  const single = !/\s/.test(sample) && /[A-Z]/.test(sample);
  const re = single
    ? new RegExp(`(?<![A-Za-z])(?:${escapeRe(sample)}|${escapeRe(sample.toUpperCase())})(?![A-Za-z]|-[a-z])`, "g")
    : new RegExp(`(?<![A-Za-z])${escapeRe(sample)}(?![A-Za-z])`, "gi");
  const replacements: Record<string, string> = {};
  for (const node of extractTextNodes(html)) {
    if (!re.test(node.text)) continue;
    re.lastIndex = 0;
    replacements[String(node.id)] = node.text.replace(re, (hit) => (hit === hit.toUpperCase() && /[A-Z]/.test(hit) ? name.toUpperCase() : name));
  }
  return Object.keys(replacements).length ? applyTextNodes(html, replacements) : html;
}

/**
 * The accent's other shades (a darker one for small text, a lighter tint for a highlight) move to the owner's colour too,
 * keeping their own lightness, so a purple button never sits beside a rust-coloured label.
 */
/**
 * What a colour the design writes becomes when its accent moves to the owner's colour: the accent itself becomes the colour,
 * its other shades (a darker one for small text, a lighter tint for a highlight) follow it keeping their own lightness, so a purple
 * button never sits beside a rust-coloured label. Anything unrelated (greys, other hues) is returned unchanged.
 */
export function recolourHex(hit: string, oldAccent: string, newColor: string): string {
  if (!HEX.test(hit)) return hit;
  const hex = expand(hit);
  const target = expand(newColor);
  if (hex === target) return hit;
  if (hex === expand(oldAccent)) return target;
  const [oh, os] = toHsl(oldAccent);
  const [nh, ns] = toHsl(newColor);
  if (os < 0.3 || hit.length !== 7) return hit;
  const [h, s, l] = toHsl(hex);
  const apart = Math.min(Math.abs(h - oh), 360 - Math.abs(h - oh));
  if (apart > 14 || s < 0.35 || l < 0.12 || l > 0.9) return hit;
  return fromHsl([nh, Math.min(1, (s / os) * ns), l]);
}

function recolourShades(html: string, oldAccent: string, newColor: string): string {
  const [, os] = toHsl(oldAccent);
  if (os < 0.3) return html;
  return html.replace(/#[0-9a-fA-F]{6}\b/g, (hit) => recolourHex(hit, oldAccent, newColor));
}

/** The owner's description only becomes page copy when it reads like a real sentence about the business, not like a design instruction. */
const MIN_ABOUT_CHARS = 25;
const DESIGN_TALK = /\b(i want|i need|i would like|i'd like|make (it|me|the)|should (look|be)|looks?|design|website|web ?site|colou?rs?|layout|theme|fonts?|style|modern|minimal(ist)?|sleek)\b/i;

/** The description as a sentence for the page, no longer than `max` characters (cut at a sentence, else a word); null when it should not be used. */
export function descriptionCopy(about: string | undefined, max: number): string | null {
  const text = (about ?? "").replace(/\s+/g, " ").trim();
  if (text.length < MIN_ABOUT_CHARS || max < MIN_ABOUT_CHARS || DESIGN_TALK.test(text)) return null;
  let out = text;
  if (out.length > max) {
    const slice = out.slice(0, max);
    const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    if (sentence >= MIN_ABOUT_CHARS - 1) out = slice.slice(0, sentence + 1);
    else {
      const word = slice.lastIndexOf(" ");
      if (word < MIN_ABOUT_CHARS) return null;
      out = slice.slice(0, word).replace(/[\s,;:\-–—]+$/, "").replace(/\s+(and|or|but|the|a|an|of|to|for|with|in|at|on)$/i, "");
    }
  }
  out = out.charAt(0).toUpperCase() + out.slice(1);
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

type TaggedText = { id: number; text: string; tag: string };

/** The page's visible text in the same numbering as extractTextNodes, with the element each piece sits directly in. */
function taggedTexts(html: string): TaggedText[] {
  const out: TaggedText[] = [];
  let id = 0;
  let tag = "";
  const re = /<!--[\s\S]*?-->|<(script|style|noscript|svg|template|textarea|iframe)\b[\s\S]*?<\/\1\s*>|<(\/?)([a-z][a-z0-9-]*)[^>]*>|<[^>]+>/gi;
  let last = 0;
  const visit = (chunk: string) => {
    if (!/[\p{L}\p{N}]/u.test(chunk)) return;
    out.push({ id: id++, text: decodeEntities(chunk).replace(/\s+/g, " ").trim(), tag });
  };
  for (const m of html.matchAll(re)) {
    visit(html.slice(last, m.index ?? 0));
    last = (m.index ?? 0) + m[0].length;
    if (m[3]) tag = m[2] ? "" : m[3].toLowerCase();
    else tag = "";
  }
  visit(html.slice(last));
  return out;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Puts the owner's description where the design has its intro line: the first real sentence of body copy after the main heading
 * (the hero's sub-copy), and the page's search description when it has one. Conservative on purpose: it does nothing unless the
 * description reads like a sentence about the business, and never makes the line more than 1.6 times longer than the design's own.
 */
export function applyDescription(html: string, about: string | undefined): string {
  if (!about || descriptionCopy(about, 10_000) === null) return html;
  let out = html;
  const texts = taggedTexts(html);
  const h1 = texts.find((t) => t.tag === "h1");
  if (h1) {
    const after = texts.filter((t) => t.id > h1.id).slice(0, 6);
    const intro = after.find((t) => (t.tag === "p" || t.tag === "span" || t.tag === "div") && t.text.length >= 40 && t.text.split(" ").length >= 7);
    if (intro) {
      const copy = descriptionCopy(about, Math.floor(intro.text.length * 1.6));
      if (copy) out = applyTextNodes(out, { [String(intro.id)]: copy });
    }
  }
  const meta = descriptionCopy(about, 160);
  if (meta) out = out.replace(/(<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=)(["'])[\s\S]*?\2/i, (_all, head: string) => `${head}"${escapeAttr(meta)}"`);
  return out;
}

export type BrandPreviewInput = { name?: string; color?: string; designName?: string; /** What the owner wrote about their business: becomes the design's intro line when it reads like a real sentence. */ about?: string };

/** The design with the owner's name and colour on it. Anything missing or unusable is simply left as the design has it. */
export function brandPreviewHtml(html: string, input: BrandPreviewInput): string {
  let out = html;
  const name = input.name?.trim();
  if (name) {
    for (const sample of sampleNamesOnPage(html, input.designName)) {
      // A short form already inside the owner's own name would only repeat it.
      if (name.toLowerCase().includes(sample.toLowerCase())) continue;
      out = swapBrandName(out, sample, name.slice(0, 60));
    }
  }

  out = applyDescription(out, input.about);

  const color = input.color && HEX.test(input.color) ? expand(input.color) : null;
  if (color) {
    // The design's main accent (the colour its buttons and highlights use) becomes the owner's colour everywhere it is written, tokens included.
    const accent = dominantAccent(out);
    if (accent && accent !== color) {
      out = out.replace(new RegExp(escapeRe(accent), "gi"), color);
      out = recolourShades(out, accent, color);
    }
    const css = brandColorCss(color);
    if (css) out = out.includes("</head>") ? out.replace("</head>", `<style data-plx-brand-preview="true">${css}</style></head>`) : `<style data-plx-brand-preview="true">${css}</style>${out}`;
  }
  return out;
}
