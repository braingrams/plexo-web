import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import postcss, { type Rule } from "postcss";

import { computeTopLevelSections, sectionForAncestors } from "./htmlTextExtraction";

/**
 * Extracts every distinct color used on a RAW_UPLOAD template's page — from inline
 * `style="..."` attributes and from `<style>` block declarations — for the "Text Content"
 * editor's Colors section. Colors are deduped by value: the SAME color used in the header,
 * hero, and footer surfaces as ONE editable swatch labeled with all three sections, and
 * changing it rewrites every occurrence at once (a "theme color" model), rather than one
 * swatch per element. See applyColorEdits below for the write path.
 *
 * Scope: only properties whose value is a color outright (color, background-color,
 * border*-color, outline-color, SVG fill/stroke) — not shorthands that mix a color with
 * something else (e.g. `background: url(...) #fff`, already covered for its url() by
 * htmlImageExtraction.ts). Keyword values that aren't a concrete color (inherit, currentColor,
 * var(--x), etc.) are skipped — there's nothing a color picker could meaningfully edit there.
 */

const COLOR_PROPS = new Set([
  "color",
  "background-color",
  // The `background` SHORTHAND too — not to decompose it, but because "background: <color>"
  // with nothing else in the value (no url(), gradient, position, etc.) is an extremely
  // common way solid background colors actually get written, often MORE common than the
  // longhand. classifyColorValue only ever matches when the ENTIRE value is a single color
  // token or a bare var() reference, so a real multi-part shorthand ("url(...) center/cover"
  // or "#fff url(...)") still correctly falls through as unextractable — this only catches
  // the pure-color case, never risks misreading a mixed shorthand.
  "background",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "fill",
  "stroke",
]);

const SKIP_SUBTREE_TAGS = new Set(["head", "noscript", "template", "script", "style"]);

// Standard CSS named colors (CSS Color Module, Levels 1-4) mapped to their hex equivalent —
// needed because <input type="color"> only accepts a 6-digit hex value, never a keyword.
const NAMED_COLORS: Record<string, string> = {
  black: "#000000", silver: "#c0c0c0", gray: "#808080", grey: "#808080", white: "#ffffff",
  maroon: "#800000", red: "#ff0000", purple: "#800080", fuchsia: "#ff00ff", green: "#008000",
  lime: "#00ff00", olive: "#808000", yellow: "#ffff00", navy: "#000080", blue: "#0000ff",
  teal: "#008080", aqua: "#00ffff", orange: "#ffa500", aliceblue: "#f0f8ff", antiquewhite: "#faebd7",
  aquamarine: "#7fffd4", azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", blanchedalmond: "#ffebcd",
  blueviolet: "#8a2be2", brown: "#a52a2a", burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00",
  chocolate: "#d2691e", coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b", darkgray: "#a9a9a9",
  darkgreen: "#006400", darkgrey: "#a9a9a9", darkkhaki: "#bdb76b", darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f", darkorange: "#ff8c00", darkorchid: "#9932cc", darkred: "#8b0000",
  darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b", darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3", deeppink: "#ff1493",
  deepskyblue: "#00bfff", dimgray: "#696969", dimgrey: "#696969", dodgerblue: "#1e90ff",
  firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22", gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff", gold: "#ffd700", goldenrod: "#daa520", greenyellow: "#adff2f",
  honeydew: "#f0fff0", hotpink: "#ff69b4", indianred: "#cd5c5c", indigo: "#4b0082", ivory: "#fffff0",
  khaki: "#f0e68c", lavender: "#e6e6fa", lavenderblush: "#fff0f5", lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd", lightblue: "#add8e6", lightcoral: "#f08080", lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3", lightgreen: "#90ee90", lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1", lightsalmon: "#ffa07a", lightseagreen: "#20b2aa", lightskyblue: "#87cefa",
  lightslategray: "#778899", lightslategrey: "#778899", lightsteelblue: "#b0c4de", lightyellow: "#ffffe0",
  limegreen: "#32cd32", linen: "#faf0e6", magenta: "#ff00ff", mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd", mediumorchid: "#ba55d3", mediumpurple: "#9370db", mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585", midnightblue: "#191970", mintcream: "#f5fffa", mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5", navajowhite: "#ffdead", oldlace: "#fdf5e6", olivedrab: "#6b8e23",
  orangered: "#ff4500", orchid: "#da70d6", palegoldenrod: "#eee8aa", palegreen: "#98fb98",
  paleturquoise: "#afeeee", palevioletred: "#db7093", papayawhip: "#ffefd5", peachpuff: "#ffdab9",
  peru: "#cd853f", pink: "#ffc0cb", plum: "#dda0dd", powderblue: "#b0e0e6", rosybrown: "#bc8f8f",
  royalblue: "#4169e1", saddlebrown: "#8b4513", salmon: "#fa8072", sandybrown: "#f4a460",
  seagreen: "#2e8b57", seashell: "#fff5ee", sienna: "#a0522d", skyblue: "#87ceeb", slateblue: "#6a5acd",
  slategray: "#708090", slategrey: "#708090", snow: "#fffafa", springgreen: "#00ff7f",
  steelblue: "#4682b4", tan: "#d2b48c", thistle: "#d8bfd8", tomato: "#ff6347", turquoise: "#40e0d0",
  violet: "#ee82ee", wheat: "#f5deb3", whitesmoke: "#f5f5f5", yellowgreen: "#9acd32",
  rebeccapurple: "#663399", transparent: "#ffffff",
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(([^)]+)\)$/i;
const HSL_RE = /^hsla?\(([^)]+)\)$/i;
const NOT_A_CONCRETE_COLOR_RE = /^(inherit|initial|unset|revert|revert-layer|currentcolor|none|auto)$/i;
const VAR_REF_RE = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([\s\S]+))?\)$/i;

/** True if `value` is a concrete, editable color outright — a literal hex/rgb/hsl/named
 * value. Does NOT resolve `var(--x)` references (see resolveVarRef/classifyColorValue for
 * that) — this only judges a value taken at face value, which is also exactly what's needed
 * to decide whether a `--custom-property: value` DEFINITION itself is a color. */
function isExtractableColor(value: string): boolean {
  const v = value.trim();
  if (!v || v.includes("var(") || v.includes("calc(")) return false;
  if (NOT_A_CONCRETE_COLOR_RE.test(v)) return false;
  if (HEX_RE.test(v)) return true;
  if (RGB_RE.test(v) || HSL_RE.test(v)) return true;
  return v.toLowerCase() in NAMED_COLORS;
}

/** A linked stylesheet (`<link rel="stylesheet" href="css/styles.css">`) for a multi-file
 * RAW_UPLOAD template — its CSS lives in a separate TemplateAsset (Vercel Blob), never in
 * compiledHtml, so callers (the API route) must fetch each one's text content themselves and
 * pass it in here. Without this, everything in this file only ever "saw" inline `<style>`
 * blocks — for a template whose CSS (often including every `:root` variable definition) is
 * entirely in a linked file, that meant color extraction found nothing at all. */
export type ExternalStylesheet = { path: string; content: string };

/** Scans every `<style>` block AND every linked stylesheet for `--custom-property: <color>`
 * declarations (almost always in `:root`, but not assumed) — this is how most hand-built
 * templates actually define a "theme color" (`--teal: #0e7c7b;`, then `var(--teal)`
 * everywhere), so resolving these is the difference between a page's real brand colors
 * showing up here at all versus being invisible because every usage is a var() reference
 * rather than a literal value. */
function collectCssVarDefinitions($: cheerio.CheerioAPI, externalStylesheets: ExternalStylesheet[]): Map<string, string> {
  const defs = new Map<string, string>();
  function scan(cssText: string) {
    let parsed;
    try {
      parsed = postcss.parse(cssText);
    } catch {
      return;
    }
    parsed.walkDecls((decl) => {
      const prop = decl.prop.trim();
      if (!prop.startsWith("--")) return;
      if (isExtractableColor(decl.value)) defs.set(prop, decl.value.trim());
    });
  }
  $("style").each((_, styleEl) => scan($(styleEl).html() ?? ""));
  for (const sheet of externalStylesheets) scan(sheet.content);
  return defs;
}

/** If `value` is a `var(--x)` (optionally with a fallback) reference, resolves it against
 * already-collected variable definitions, falling back to the reference's own fallback value
 * when the variable itself isn't defined anywhere we can see. Returns null for anything that
 * isn't a var() reference at all, or resolves to nothing usable. */
function resolveVarRef(value: string, varDefs: Map<string, string>): { varName: string; resolved: string } | null {
  const match = VAR_REF_RE.exec(value.trim());
  if (!match) return null;
  const varName = match[1];
  const defined = varDefs.get(varName);
  if (defined !== undefined) return { varName, resolved: defined };
  const fallback = match[2]?.trim();
  if (fallback && isExtractableColor(fallback)) return { varName, resolved: fallback };
  return null;
}

/** The single classification step every walk (extract/annotate/apply) must use identically —
 * either this is a var() reference that resolves to a concrete color, or it's a concrete
 * color outright. Returns null for anything else (inherit, unresolvable var(), calc(), …),
 * meaning "don't count this as an occurrence at all" — callers must only advance their
 * position counters when this returns non-null, or extraction/annotation/apply drift apart. */
function classifyColorValue(value: string, varDefs: Map<string, string>): { resolved: string; viaVar?: string } | null {
  const varRef = resolveVarRef(value, varDefs);
  if (varRef) return { resolved: varRef.resolved, viaVar: varRef.varName };
  if (isExtractableColor(value)) return { resolved: value };
  return null;
}

function normalizeColorKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function parseStyleAttr(styleStr: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (styleStr ?? "").split(";").forEach((pair) => {
    const idx = pair.indexOf(":");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim().toLowerCase();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function serializeStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

/** Same shape as htmlTextExtraction.ts's walk(), but visits every ELEMENT (not text node) —
 * colors live on elements' style attributes, not on text. */
function walkElements(
  $: cheerio.CheerioAPI,
  root: AnyNode,
  ancestors: Element[],
  visit: (el: Element, ancestors: Element[]) => void,
): void {
  const children = $(root).contents().toArray();
  for (const node of children) {
    if (node.type !== "tag") continue;
    const el = node as Element;
    const tag = el.name.toLowerCase();
    if (SKIP_SUBTREE_TAGS.has(tag)) continue;
    visit(el, ancestors);
    walkElements($, el, [...ancestors, el], visit);
  }
}

function sectionForSelector($: cheerio.CheerioAPI, selector: string, topLevelSections: Map<Element, string>): string {
  try {
    const matched = $(selector).first();
    if (matched.length === 0) return "Content";
    const el = matched.get(0) as Element;
    const ancestors = [...matched.parents().toArray().reverse(), el] as Element[];
    return sectionForAncestors($, ancestors, topLevelSections);
  } catch {
    // Selector syntax cheerio can't match (e.g. :hover) — no section to resolve, fall back.
    return "Content";
  }
}

type ColorOccurrence =
  | { kind: "inline"; index: number; section: string; viaVar?: string }
  | { kind: "css"; index: number; section: string; viaVar?: string }
  // A declaration inside a LINKED stylesheet (TemplateAsset), not an inline <style> block —
  // `index` is scoped to that one file (each external file gets its own counter, reset per
  // file), so `path` is required to know which file it refers to. Rewriting this occurrence
  // means rewriting that file's OWN content, returned separately — see applyColorEdits.
  | { kind: "external-css"; path: string; index: number; section: string; viaVar?: string };

export type ExtractedColorNode = {
  id: number;
  /** Representative raw value (whichever occurrence was encountered first) — what's shown
   * and edited. Dedup itself is keyed on a normalized form, not this literal string. */
  value: string;
  /** Structural sections this color appears in, first-seen document order, deduped. */
  sections: string[];
  occurrences: ColorOccurrence[];
};

/** Walks every element's inline style plus every <style> block's declarations, in the same
 * deterministic order applyColorEdits re-walks, grouping by normalized color value. Both
 * functions must visit occurrences in IDENTICAL order for the id correlation between a GET
 * and a later PATCH to hold. */
export function extractColorNodes(html: string, externalStylesheets: ExternalStylesheet[] = []): ExtractedColorNode[] {
  const $ = cheerio.load(html);
  const root = $("body").length > 0 ? $("body").get(0)! : $.root().get(0)!;
  const topLevelSections = computeTopLevelSections($, root);
  const varDefs = collectCssVarDefinitions($, externalStylesheets);

  const byKey = new Map<string, { value: string; sections: string[]; sectionSet: Set<string>; occurrences: ColorOccurrence[] }>();

  function record(rawValue: string, section: string, occurrence: ColorOccurrence) {
    const key = normalizeColorKey(rawValue);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { value: rawValue, sections: [], sectionSet: new Set(), occurrences: [] };
      byKey.set(key, entry);
    }
    entry.occurrences.push(occurrence);
    if (!entry.sectionSet.has(section)) {
      entry.sectionSet.add(section);
      entry.sections.push(section);
    }
  }

  let inlineIndex = 0;
  walkElements($, root, [], (el, ancestors) => {
    const style = parseStyleAttr($(el).attr("style"));
    const section = sectionForAncestors($, [...ancestors, el], topLevelSections);
    for (const prop of Object.keys(style)) {
      if (!COLOR_PROPS.has(prop)) continue;
      const classified = classifyColorValue(style[prop], varDefs);
      if (!classified) continue;
      record(classified.resolved, section, { kind: "inline", index: inlineIndex, section, viaVar: classified.viaVar });
      inlineIndex++;
    }
  });

  let cssIndex = 0;
  $("style").each((_, styleEl) => {
    const cssText = $(styleEl).html() ?? "";
    let parsed;
    try {
      parsed = postcss.parse(cssText);
    } catch {
      return;
    }
    parsed.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (!COLOR_PROPS.has(prop)) return;
      const classified = classifyColorValue(decl.value, varDefs);
      if (!classified) return;
      const rule = decl.parent;
      const selector = rule && rule.type === "rule" ? (rule as Rule).selector : "";
      const section = selector ? sectionForSelector($, selector, topLevelSections) : "Content";
      record(classified.resolved, section, { kind: "css", index: cssIndex, section, viaVar: classified.viaVar });
      cssIndex++;
    });
  });

  for (const sheet of externalStylesheets) {
    let parsed;
    try {
      parsed = postcss.parse(sheet.content);
    } catch {
      continue;
    }
    let externalIndex = 0;
    parsed.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (!COLOR_PROPS.has(prop)) return;
      const classified = classifyColorValue(decl.value, varDefs);
      if (!classified) return;
      const rule = decl.parent;
      const selector = rule && rule.type === "rule" ? (rule as Rule).selector : "";
      // Selector resolution is against the MAIN document's DOM regardless of which file the
      // rule physically lives in — the selector targets page elements either way.
      const section = selector ? sectionForSelector($, selector, topLevelSections) : "Content";
      record(classified.resolved, section, { kind: "external-css", path: sheet.path, index: externalIndex, section, viaVar: classified.viaVar });
      externalIndex++;
    });
  }

  return Array.from(byKey.values()).map((entry, id) => ({
    id,
    value: entry.value,
    sections: entry.sections,
    occurrences: entry.occurrences,
  }));
}

/**
 * Tags every element a color occurrence affects with `data-pcolor` — one `id:property` token
 * per occurrence, space-separated if an element carries more than one (either several colors,
 * or the same color used for two different properties on that element). This is what lets the
 * "Text Content" editor's live preview recolor instantly while dragging the picker: for a
 * CSS-rule-based occurrence, every element that selector matches gets the SAME token, so
 * setting that property inline on each one (which the caller does, not this function) visually
 * overrides the underlying rule via ordinary inline-style specificity — no need to rewrite the
 * <style> block's text at edit time, and no distinction between an originally-inline vs
 * originally-CSS-rule color once tagged. Re-derives ids by calling extractColorNodes against
 * this same html, then re-walks in the identical order to place the tags.
 */
export function annotateColorNodesForPreview(html: string, externalStylesheets: ExternalStylesheet[] = []): string {
  const nodes = extractColorNodes(html, externalStylesheets);
  // Each occurrence's tag needs the color's id AND which of that color's sections THIS
  // particular occurrence belongs to (as an index into node.sections) — that's what lets
  // the editor's click-to-scroll cycle through a color's sections one at a time, rather than
  // only ever jumping to whichever element happens to be first in the DOM.
  const inlineTagByIndex = new Map<number, { id: number; sectionIndex: number }>();
  const cssTagByIndex = new Map<number, { id: number; sectionIndex: number }>();
  const externalTagByIndex = new Map<string, Map<number, { id: number; sectionIndex: number }>>();
  for (const node of nodes) {
    for (const occ of node.occurrences) {
      const sectionIndex = node.sections.indexOf(occ.section);
      const tag = { id: node.id, sectionIndex };
      if (occ.kind === "inline") inlineTagByIndex.set(occ.index, tag);
      else if (occ.kind === "css") cssTagByIndex.set(occ.index, tag);
      else {
        let byIndex = externalTagByIndex.get(occ.path);
        if (!byIndex) {
          byIndex = new Map();
          externalTagByIndex.set(occ.path, byIndex);
        }
        byIndex.set(occ.index, tag);
      }
    }
  }

  const $ = cheerio.load(html);
  const root = $("body").length > 0 ? $("body").get(0)! : $.root().get(0)!;
  const varDefs = collectCssVarDefinitions($, externalStylesheets);

  function appendTag(el: Element, id: number, prop: string, sectionIndex: number) {
    const token = `${id}:${prop}:${sectionIndex}`;
    const existing = $(el).attr("data-pcolor");
    $(el).attr("data-pcolor", existing ? `${existing} ${token}` : token);
  }

  let inlineIndex = 0;
  walkElements($, root, [], (el) => {
    const style = parseStyleAttr($(el).attr("style"));
    for (const prop of Object.keys(style)) {
      if (!COLOR_PROPS.has(prop) || !classifyColorValue(style[prop], varDefs)) continue;
      const tag = inlineTagByIndex.get(inlineIndex);
      if (tag) appendTag(el, tag.id, prop, tag.sectionIndex);
      inlineIndex++;
    }
  });

  let cssIndex = 0;
  $("style").each((_, styleEl) => {
    const cssText = $(styleEl).html() ?? "";
    let parsed;
    try {
      parsed = postcss.parse(cssText);
    } catch {
      return;
    }
    parsed.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (!COLOR_PROPS.has(prop) || !classifyColorValue(decl.value, varDefs)) return;
      const rule = decl.parent;
      const selector = rule && rule.type === "rule" ? (rule as Rule).selector : "";
      const tag = cssTagByIndex.get(cssIndex);
      if (tag && selector) {
        try {
          $(selector).each((__, matchedEl) => appendTag(matchedEl as Element, tag.id, prop, tag.sectionIndex));
        } catch {
          // Selector syntax cheerio can't match (e.g. :hover) — nothing to tag for this
          // occurrence, id sequence below still advances consistently.
        }
      }
      cssIndex++;
    });
  });

  for (const sheet of externalStylesheets) {
    let parsed;
    try {
      parsed = postcss.parse(sheet.content);
    } catch {
      continue;
    }
    const byIndex = externalTagByIndex.get(sheet.path);
    let externalIndex = 0;
    parsed.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (!COLOR_PROPS.has(prop) || !classifyColorValue(decl.value, varDefs)) return;
      const rule = decl.parent;
      const selector = rule && rule.type === "rule" ? (rule as Rule).selector : "";
      const tag = byIndex?.get(externalIndex);
      if (tag && selector) {
        try {
          $(selector).each((__, matchedEl) => appendTag(matchedEl as Element, tag.id, prop, tag.sectionIndex));
        } catch {
          // Selector syntax cheerio can't match (e.g. :hover) — nothing to tag for this
          // occurrence, id sequence below still advances consistently.
        }
      }
      externalIndex++;
    });
  }

  return $.html();
}

export type ColorEdit = { id: number; value: string };

export type ApplyColorEditsResult = {
  html: string;
  /** path -> new full CSS text, one entry per linked stylesheet that had an edited
   * declaration or variable definition rewritten — empty when every edit landed in
   * compiledHtml itself. Callers must persist each of these back to that TemplateAsset. */
  updatedStylesheets: Record<string, string>;
};

/**
 * Re-derives the same id -> occurrences mapping extractColorNodes produced (by calling it
 * against this same html + externalStylesheets), then re-walks fresh to rewrite every
 * occurrence belonging to an edited color — this is the "theme color" behavior: one edit
 * updates every inline style, every inline <style> declaration, and every linked stylesheet
 * declaration that held that value, wherever on the page it was. Linked-stylesheet edits are
 * returned separately (updatedStylesheets) rather than spliced into the returned html, since
 * their real content lives in a different file entirely.
 */
export function applyColorEdits(
  html: string,
  edits: ColorEdit[],
  externalStylesheets: ExternalStylesheet[] = [],
): ApplyColorEditsResult {
  if (edits.length === 0) return { html, updatedStylesheets: {} };

  const nodes = extractColorNodes(html, externalStylesheets);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const inlineTargets = new Map<number, string>();
  const cssTargets = new Map<number, string>();
  const externalTargets = new Map<string, Map<number, string>>();
  // Occurrences that came from a var(--x) reference are never rewritten at their own site —
  // doing so would detach that one usage from the shared variable while leaving every other
  // reference (and the variable itself) untouched, breaking the theming instead of editing
  // it. Rewriting the variable's OWN definition is the correct edit: every var(--x) reference
  // picks up the new value automatically via the normal CSS cascade, with nothing else to touch.
  // A variable can in principle be defined in more than one CSS source; every definition
  // found gets rewritten, not just the first, so nothing keeps the old value by accident.
  const varTargets = new Map<string, string>();
  for (const edit of edits) {
    const node = nodeById.get(edit.id);
    if (!node) continue;
    for (const occ of node.occurrences) {
      if (occ.viaVar) {
        varTargets.set(occ.viaVar, edit.value);
      } else if (occ.kind === "inline") {
        inlineTargets.set(occ.index, edit.value);
      } else if (occ.kind === "css") {
        cssTargets.set(occ.index, edit.value);
      } else {
        let byIndex = externalTargets.get(occ.path);
        if (!byIndex) {
          byIndex = new Map();
          externalTargets.set(occ.path, byIndex);
        }
        byIndex.set(occ.index, edit.value);
      }
    }
  }
  if (inlineTargets.size === 0 && cssTargets.size === 0 && varTargets.size === 0 && externalTargets.size === 0) {
    return { html, updatedStylesheets: {} };
  }

  const $ = cheerio.load(html);
  const root = $("body").length > 0 ? $("body").get(0)! : $.root().get(0)!;
  const varDefs = collectCssVarDefinitions($, externalStylesheets);

  let inlineIndex = 0;
  walkElements($, root, [], (el) => {
    const style = parseStyleAttr($(el).attr("style"));
    let changed = false;
    for (const prop of Object.keys(style)) {
      if (!COLOR_PROPS.has(prop) || !classifyColorValue(style[prop], varDefs)) continue;
      const newValue = inlineTargets.get(inlineIndex);
      if (newValue !== undefined) {
        style[prop] = newValue;
        changed = true;
      }
      inlineIndex++;
    }
    if (changed) {
      const serialized = serializeStyle(style);
      if (serialized) $(el).attr("style", serialized);
    }
  });

  // Single counter spanning ALL <style> blocks (not reset per block) — must advance
  // identically to extractColorNodes' cssIndex regardless of whether a given declaration
  // ends up rewritten, so every later declaration keeps lining up with the same id.
  let cssIndex = 0;
  $("style").each((_, styleEl) => {
    const cssText = $(styleEl).html() ?? "";
    let parsed;
    try {
      parsed = postcss.parse(cssText);
    } catch {
      return;
    }
    let changed = false;
    parsed.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (COLOR_PROPS.has(prop) && classifyColorValue(decl.value, varDefs)) {
        const newValue = cssTargets.get(cssIndex);
        if (newValue !== undefined) {
          decl.value = newValue;
          changed = true;
        }
        cssIndex++;
        return;
      }
      // Not a tracked color property/value — still check whether THIS declaration is the
      // definition of an edited variable (`--teal: ...`), independent of the cssIndex
      // sequence above, since custom-property definitions were never part of that count.
      const propTrimmed = decl.prop.trim();
      if (propTrimmed.startsWith("--") && varTargets.has(propTrimmed)) {
        decl.value = varTargets.get(propTrimmed)!;
        changed = true;
      }
    });
    if (changed) $(styleEl).text(parsed.toString());
  });

  const updatedStylesheets: Record<string, string> = {};
  for (const sheet of externalStylesheets) {
    let parsed;
    try {
      parsed = postcss.parse(sheet.content);
    } catch {
      continue;
    }
    const byIndex = externalTargets.get(sheet.path);
    let changed = false;
    let externalIndex = 0;
    parsed.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (COLOR_PROPS.has(prop) && classifyColorValue(decl.value, varDefs)) {
        const newValue = byIndex?.get(externalIndex);
        if (newValue !== undefined) {
          decl.value = newValue;
          changed = true;
        }
        externalIndex++;
        return;
      }
      const propTrimmed = decl.prop.trim();
      if (propTrimmed.startsWith("--") && varTargets.has(propTrimmed)) {
        decl.value = varTargets.get(propTrimmed)!;
        changed = true;
      }
    });
    if (changed) updatedStylesheets[sheet.path] = parsed.toString();
  }

  return { html: $.html(), updatedStylesheets };
}
