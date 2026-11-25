/**
 * Carries what the owner saw in the preview (their name, their words, SOL's words, their colour, their logo) into the page's own design data.
 *
 * A page built in the visual editor keeps its design as JSON and its HTML is compiled from it; the editor, a republish and every
 * later recompile read the JSON, not the HTML. If only the HTML were changed, the owner's name and words would vanish the first time
 * they touched the page. So the same changes are made to the JSON: the visible text of the design as it was (`originalHtml`) is
 * compared with the text of the design the owner approved (`finalHtml`), and every piece of text that changed is replaced where
 * the JSON holds it.
 *
 * Why a piece of text is sometimes hard to find in the JSON (and what this file does about each):
 *  - the JSON holds it with entities, other whitespace or curly quotes ("Iron &amp; Grain", a no-break space): matched on a
 *    normalised form, in every spelling;
 *  - the JSON holds a sentence as rich text with inline tags ("Build <em>strong</em> habits") while the page shows pieces: the
 *    pieces of one block are joined into a run, the run is matched through the inline tags, and only the words that changed are replaced
 *    so the emphasis survives; when the JSON keeps the pieces in separate fields they are replaced one by one;
 *  - the same text appears several times and only some were changed ("Learn more" x3): the n-th occurrence is changed, but only when
 *    the JSON has exactly as many occurrences to line up with;
 *  - the text is in the site's shared header or footer, which are separate designs: syncDesigns takes all of them at once, and a text
 *    counts as found when any of them held it;
 *  - SOL added or removed a piece of text, so the two pages have a different number of pieces: changed stretches are lined up by
 *    similarity instead of by position;
 *  - alt text, placeholders and titles are attributes, not text: they are compared too.
 * Anything that still cannot be placed is returned (`unmatched`) so the owner can be told in plain words.
 *
 * Pure and dependency-free (no SDK, no database), so it is unit tested on its own. Validation (parseV2Design) is the caller's job.
 */
import { decodeEntities, mapText } from "./htmlText";
import { recolourHex } from "./brandPreview";
import { withHeaderLogo } from "@/lib/sites/headerLogo";

export type TextChange = {
  from: string;
  to: string;
  /** The same change piece by piece, when `from` is a run of several text pieces split by inline tags and the pieces lined up one to one. */
  parts?: TextChange[];
  /** Which occurrence of `from` (0-based, in reading order) this is. Only set when the same text appears several times and not all of them became the same thing. */
  nth?: number;
  /** How many times `from` appears on the original page (set with `nth`). */
  of?: number;
};

export type SyncReport = {
  /** How many pieces of text changed between the two versions. */
  textChanges: number;
  /** How many of them were found in the design data and replaced. */
  textsApplied: number;
  /** Changes that could not be lined up with a place in the original (text SOL added or removed, or a mix-up between repeated texts). */
  textsSkipped: number;
  /** Picture addresses swapped (SOL's photos, the owner's logo) and found in the design data. */
  imagesApplied: number;
  /** Colour values recoloured in the design data. */
  coloursApplied: number;
  /** True when the title or search description of the page was updated. */
  metaApplied: boolean;
  /** True when a logo that was added, replaced or removed on the page was carried into the design's header. */
  logoApplied: boolean;
  /** The changed pieces of text that were not found anywhere in the design data. */
  unmatched: TextChange[];
  /** Plain-words reasons something could not be mapped (empty when everything was). */
  problems: string[];
};

// ---------------------------------------------------------------- reading text

const NAMED: Record<string, string> = { rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", trade: "™" };
export const decode = (s: string): string =>
  decodeEntities(s)
    .replace(/&(rsquo|lsquo|ldquo|rdquo|ndash|mdash|hellip|copy|reg|trade);/g, (_m, n: string) => NAMED[n])
    .replace(/&#(\d{1,6});/g, (m, n: string) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m; })
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, n: string) => { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m; });
const norm = (s: string) => decode(s).replace(/\s+/g, " ").trim();
/** The form two spellings of the same text share: entities decoded, spaces collapsed, curly quotes and long dashes made plain. */
const fold = (s: string) => norm(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-");

/** Every piece of visible text on the page, in reading order, with no limit on how many (unlike extractTextNodes, which stops at what SOL can read). */
export function allVisibleTexts(html: string): string[] {
  const out: string[] = [];
  mapText(html, (_id, text) => {
    out.push(text);
    return undefined;
  });
  return out;
}

const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "big", "cite", "code", "data", "del", "dfn", "em", "font", "i", "ins", "kbd", "label", "mark", "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr"]);
const RUN_TOKEN = /<!--[\s\S]*?-->|<(script|style|noscript|svg|template|textarea|iframe)\b[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>|<[^>]+>/gi;

export type Run = { text: string; nodes: string[] };

/**
 * The visible text of the page as it reads: the pieces of one block (a heading, a paragraph, a button) joined into one run even when
 * inline tags split them ("Build <em>strong</em> habits" is one run of three pieces). Every piece is also kept on its own.
 */
export function visibleRuns(html: string): Run[] {
  const runs: Run[] = [];
  let buf = "";
  let nodes: string[] = [];
  const text = (chunk: string) => {
    if (!chunk) return;
    buf += chunk;
    if (/[\p{L}\p{N}]/u.test(chunk)) nodes.push(norm(chunk));
  };
  const flush = () => {
    if (nodes.length) runs.push({ text: norm(buf), nodes });
    buf = "";
    nodes = [];
  };
  let last = 0;
  let justClosed = "";
  for (const m of html.matchAll(RUN_TOKEN)) {
    const between = html.slice(last, m.index ?? 0);
    text(between);
    last = (m.index ?? 0) + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    if (/\S/.test(between)) justClosed = "";
    const tag = m[3]?.toLowerCase();
    // Links side by side (a menu) are separate pieces of text, not one sentence; a link inside a sentence is part of it.
    if (tag === "a" && !m[2] && justClosed === "a") flush();
    justClosed = tag && m[2] ? tag : "";
    if (tag && INLINE.has(tag)) continue;
    flush();
  }
  text(html.slice(last));
  flush();
  return runs;
}

const ATTR_TEXT = /\b(?:alt|placeholder|title|aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
/** Words kept in attributes (picture descriptions, field hints, tooltips) in the order they appear. */
function attributeTexts(html: string): string[] {
  const body = html.replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  return [...body.matchAll(ATTR_TEXT)].map((m) => norm(m[1] ?? m[2] ?? "")).filter((t) => /[\p{L}\p{N}]/u.test(t));
}

// ---------------------------------------------------------------- lining the two pages up

const MAX_ALIGN = 3000;
const SIMILAR = 0.3;

const wordSet = (s: string) => new Set(fold(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
function similarity(a: string, b: string): number {
  const x = wordSet(a);
  const y = wordSet(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return (2 * both) / (x.size + y.size);
}

type Pair = { i: number; j: number };

/** Lines two changed stretches of different length up by how alike they read, keeping their order; what is left over has no partner. */
function pairBySimilarity(a: string[], b: string[], offA: number, offB: number): { pairs: Pair[]; left: number } {
  const m = a.length;
  const n = b.length;
  if (!m || !n || m * n > 250_000) return { pairs: [], left: m + n };
  const score = new Float64Array((m + 1) * (n + 1));
  const at = (i: number, j: number) => i * (n + 1) + j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const s = similarity(a[i - 1], b[j - 1]);
      score[at(i, j)] = Math.max(score[at(i - 1, j)], score[at(i, j - 1)], s >= SIMILAR ? score[at(i - 1, j - 1)] + s : 0);
    }
  }
  const pairs: Pair[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const here = score[at(i, j)];
    if (here === score[at(i - 1, j)]) i--;
    else if (here === score[at(i, j - 1)]) j--;
    else { pairs.push({ i: offA + i - 1, j: offB + j - 1 }); i--; j--; }
  }
  pairs.reverse();
  return { pairs, left: m + n - 2 * pairs.length };
}

/**
 * Lines the original and final lists up: the longest common run of identical pieces first, then the changed stretches between them. Two
 * stretches of equal length are paired position by position (a rewritten heading stays that heading even when it shares no words);
 * two of different length (SOL added or dropped a piece) are paired by similarity. `left` counts the pieces with no partner.
 */
function alignLists(a: string[], b: string[]): { pairs: Pair[]; left: number } {
  const n = a.length;
  const m = b.length;
  if (n > MAX_ALIGN || m > MAX_ALIGN) return { pairs: [], left: Math.max(n, m) };
  let head = 0;
  while (head < n && head < m && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
  const an = n - head - tail;
  const bn = m - head - tail;
  const width = bn + 1;
  const lcs = new Uint16Array((an + 1) * width);
  for (let i = an - 1; i >= 0; i--) {
    for (let j = bn - 1; j >= 0; j--) {
      lcs[i * width + j] = a[head + i] === b[head + j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const pairs: Pair[] = [];
  let left = 0;
  let gapA: number[] = [];
  let gapB: number[] = [];
  const flush = () => {
    if (gapA.length && gapA.length === gapB.length) gapA.forEach((ai, k) => pairs.push({ i: ai, j: gapB[k] }));
    else if (gapA.length || gapB.length) {
      const found = pairBySimilarity(gapA.map((k) => a[k]), gapB.map((k) => b[k]), 0, 0);
      for (const p of found.pairs) pairs.push({ i: gapA[p.i], j: gapB[p.j] });
      left += found.left;
    }
    gapA = [];
    gapB = [];
  };
  let i = 0;
  let j = 0;
  while (i < an || j < bn) {
    if (i < an && j < bn && a[head + i] === b[head + j]) { flush(); i++; j++; }
    else if (j >= bn || (i < an && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) gapA.push(head + i++);
    else gapB.push(head + j++);
  }
  flush();
  return { pairs, left };
}

const countOf = (list: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};

/**
 * What changed between the two pages' visible text (and the words in their attributes), as changes to make in the design data. A text that
 * is repeated and was not changed everywhere the same way gets the occurrence it belongs to (`nth`).
 */
export function pairTextChanges(originalHtml: string, finalHtml: string): { changes: TextChange[]; skipped: number } {
  const ra = visibleRuns(originalHtml);
  const rb = visibleRuns(finalHtml);
  const a = ra.map((r) => r.text);
  const b = rb.map((r) => r.text);
  const aligned = alignLists(a, b);
  let skipped = aligned.left;

  type Raw = { from: string; to: string; idx: number; run: boolean; parts?: TextChange[] };
  const raw: Raw[] = [];
  for (const { i, j } of aligned.pairs) {
    if (a[i] === b[j]) continue;
    let parts: TextChange[] | undefined;
    if (ra[i].nodes.length > 1 && ra[i].nodes.length === rb[j].nodes.length) {
      parts = ra[i].nodes.flatMap((from, k) => (from === rb[j].nodes[k] ? [] : [{ from, to: rb[j].nodes[k] }]));
      if (!parts.length) parts = undefined;
    }
    raw.push({ from: a[i], to: b[j], idx: i, run: true, ...(parts ? { parts } : {}) });
  }

  const attrA = attributeTexts(originalHtml);
  const attrB = attributeTexts(finalHtml);
  const attrAligned = alignLists(attrA, attrB);
  skipped += attrAligned.left;
  for (const { i, j } of attrAligned.pairs) if (attrA[i] !== attrB[j]) raw.push({ from: attrA[i], to: attrB[j], idx: i, run: false });

  const occ = countOf([...a, ...attrA]);
  const occRuns = countOf(a);
  const byFrom = new Map<string, Raw[]>();
  for (const r of raw) byFrom.set(r.from, [...(byFrom.get(r.from) ?? []), r]);
  const changes: TextChange[] = [];
  for (const [from, group] of byFrom) {
    const total = occ.get(from) ?? 0;
    const sameTo = group.every((g) => g.to === group[0].to);
    if (sameTo && group.length === total) {
      changes.push({ from, to: group[0].to, ...(group[0].parts ? { parts: group[0].parts } : {}) });
    } else if (group.every((g) => g.run) && total === (occRuns.get(from) ?? 0)) {
      // Repeated text with some occurrences changed differently or not at all: each change is tied to its occurrence.
      for (const g of group) {
        let nth = 0;
        for (let k = 0; k < g.idx; k++) if (a[k] === from) nth++;
        changes.push({ from, to: g.to, nth, of: total, ...(g.parts ? { parts: g.parts } : {}) });
      }
    } else skipped += group.length;
  }
  return { changes, skipped };
}

const imgSrcs = (html: string): string[] => [...html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => decodeEntities(m[1] ?? m[2] ?? ""));

/** Pictures that were swapped (same count of pictures before and after, the same place now showing another address). */
export function pairImageChanges(originalHtml: string, finalHtml: string): TextChange[] {
  const a = imgSrcs(originalHtml);
  const b = imgSrcs(finalHtml);
  if (a.length !== b.length) return [];
  const map = new Map<string, string>();
  const clash = new Set<string>();
  a.forEach((from, k) => {
    if (!from || !b[k] || from === b[k]) return;
    const seen = map.get(from);
    if (seen === undefined) map.set(from, b[k]);
    else if (seen !== b[k]) clash.add(from);
  });
  return [...map].filter(([from]) => !clash.has(from)).map(([from, to]) => ({ from, to }));
}

const titleOf = (html: string): string => norm(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
const descriptionOf = (html: string): string => {
  const tag = html.match(/<meta\b[^>]*\bname=["']description["'][^>]*>/i)?.[0] ?? "";
  return norm(tag.match(/\bcontent=("([^"]*)"|'([^']*)')/i)?.[2] ?? tag.match(/\bcontent=("([^"]*)"|'([^']*)')/i)?.[3] ?? "");
};

/** The page title and search description when the approved design says something different from the original. */
export function metaChanges(originalHtml: string, finalHtml: string): { htmlTitle?: string; metaDescription?: string } {
  const out: { htmlTitle?: string; metaDescription?: string } = {};
  const t = titleOf(finalHtml);
  if (t && t !== titleOf(originalHtml)) out.htmlTitle = t.slice(0, 200);
  const d = descriptionOf(finalHtml);
  if (d && d !== descriptionOf(originalHtml)) out.metaDescription = d.slice(0, 300);
  return out;
}

// ---------------------------------------------------------------- the logo

/** The address of the logo picture on a page: an image marked as a logo, or the picture inside a logo/brand link. Null when the page has none. */
export function logoSrcOf(html: string): string | null {
  const body = html.replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  const srcOf = (tag: string) => {
    const m = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    return m ? decodeEntities(m[1] ?? m[2] ?? "") : null;
  };
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    if (/\b(?:class|id)\s*=\s*(?:"[^"]*logo[^"]*"|'[^']*logo[^']*')/i.test(m[0])) return srcOf(m[0]);
  }
  for (const m of body.matchAll(/<(a|div|span)\b[^>]*\bclass\s*=\s*(?:"[^"]*(?:logo|brand)[^"]*"|'[^']*(?:logo|brand)[^']*')[^>]*>([\s\S]{0,600}?)<\/\1>/gi)) {
    const img = m[2].match(/<img\b[^>]*>/i);
    if (img) return srcOf(img[0]);
  }
  return null;
}

export type LogoChange = { kind: "added" | "replaced" | "removed"; to: string };

/** Whether the approved page has a logo the original did not (added), another one (replaced), or none where the original had one (removed). */
export function logoChange(originalHtml: string, finalHtml: string): LogoChange | null {
  const from = logoSrcOf(originalHtml);
  const to = logoSrcOf(finalHtml);
  if (!from && to) return { kind: "added", to };
  if (from && !to) return { kind: "removed", to: "" };
  if (from && to && from !== to) return { kind: "replaced", to };
  return null;
}

// ---------------------------------------------------------------- finding text in the design data

/** Keys that hold structure (ids, kinds, addresses), never words the owner reads. */
const SKIP_KEYS = new Set(["id", "type", "format", "slug", "href", "url", "className", "class", "customJs", "component", "variant", "ref"]);
/** The brand has no page text in it (and can hold tens of thousands of values): text is never searched for there. */
const NOT_TEXT_KEYS = new Set(["designSystem", "designSystemRef", "designSystemUrl"]);
const MIN_CONTAINED = 12;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const encodeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const looksRich = (s: string) => /<[a-z!/][^>]*>/i.test(s) || /&(?:amp|lt|gt|quot|nbsp|#\d+|#x[0-9a-f]+);/i.test(s);

const WS = "(?:\\s|&nbsp;|&#160;|&#xa0;)";
const TAG = "(?:<[^>]*>)*";
const CHAR: Array<[RegExp, string]> = [
  [/&/, "(?:&amp;|&#38;|&)"],
  [/</, "(?:&lt;|<)"],
  [/>/, "(?:&gt;|>)"],
  [/['‘’]/, "(?:'|‘|’|&#39;|&#x27;|&apos;|&rsquo;|&lsquo;)"],
  [/["“”]/, '(?:"|“|”|&quot;|&ldquo;|&rdquo;)'],
  [/[-–—]/, "(?:-|–|—|&ndash;|&mdash;)"],
];

/** A regex source that matches `text` however the design data spells it (entities, other spaces, curly quotes); with `tags`, inline tags may sit between any two characters. */
function flexSource(text: string, tags: boolean): string {
  const parts: string[] = [];
  for (const ch of norm(text)) {
    if (ch === " ") parts.push(tags ? `${TAG}${WS}(?:${WS}|<[^>]*>)*` : `${WS}+`);
    else parts.push(CHAR.find(([re]) => re.test(ch))?.[1] ?? escapeRe(ch));
  }
  return parts.join(tags ? TAG : "");
}

type Compiled = { whole: string; plain: RegExp; standalone: RegExp; tag?: RegExp; tagTo?: string };
const compiledCache = new WeakMap<TextChange, Compiled>();

function compile(c: TextChange): Compiled {
  let hit = compiledCache.get(c);
  if (hit) return hit;
  const src = flexSource(c.from, false);
  hit = {
    whole: fold(c.from),
    plain: new RegExp(`()(${src})`, "gd"),
    standalone: new RegExp(`(?<=>|^)${WS}*()(${src})${WS}*(?=<|$)`, "gd"),
  };
  // For a run split by inline tags: only the words that changed are replaced, the unchanged words before and after anchor the match.
  const f = norm(c.from).split(" ");
  const t = norm(c.to).split(" ");
  let p = 0;
  while (p < f.length - 1 && p < t.length && f[p] === t[p]) p++;
  let q = 0;
  while (q < f.length - p - 1 && q < t.length - p && f[f.length - 1 - q] === t[t.length - 1 - q]) q++;
  const mid = f.slice(p, f.length - q).join(" ");
  const pre = f.slice(0, p).join(" ");
  const suf = f.slice(f.length - q).join(" ");
  const joiner = `${TAG}${WS}(?:${WS}|<[^>]*>)*`;
  const body = `${pre ? `(?:${flexSource(pre, true)})${joiner}` : ""}(${flexSource(mid, true)})${suf ? `${joiner}(?:${flexSource(suf, true)})` : ""}`;
  const anchored = !pre && !suf && norm(c.from).length < MIN_CONTAINED;
  hit.tag = new RegExp(anchored ? `(?<=>|^)${WS}*${body}${WS}*(?=<|$)` : body, "gd");
  hit.tagTo = t.slice(p, t.length - q).join(" ");
  compiledCache.set(c, hit);
  return hit;
}

/** Replaces, in one string, every piece of it that is the capture group 1 of `re`; `pick` says what to put there (null keeps it). */
function replaceCapture(s: string, re: RegExp, pick: (hit: string) => string | null): string {
  let out = "";
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[0] === "") { re.lastIndex++; continue; }
    const span = (m as RegExpExecArray & { indices?: Array<[number, number]> }).indices?.[2] ?? (m as RegExpExecArray & { indices?: Array<[number, number]> }).indices?.[1];
    if (!span) continue;
    const rep = pick(s.slice(span[0], span[1]));
    if (rep === null) continue;
    out += s.slice(last, span[0]) + rep;
    last = span[1];
  }
  return out + s.slice(last);
}

type Place = "plain" | "tags";

/**
 * Looks for the change's `from` in one string and replaces each place it finds, unless `pick` declines. "plain" matches the text
 * as a whole value, inside a longer value (when it is long enough to be unmistakable) or standing alone between tags; "tags" also
 * matches through inline tags and replaces only the words that changed.
 */
function rewrite(s: string, c: TextChange, place: Place, pick: (to: string) => string | null): string {
  if (!s || s.length < 2) return s;
  const k = compile(c);
  const rich = looksRich(s);
  const enc = (v: string) => (rich ? encodeText(v) : v);
  if (place === "plain") {
    if (s.trim() && fold(s) === k.whole) {
      const lead = s.match(/^\s*/)?.[0] ?? "";
      const trail = s.match(/\s*$/)?.[0] ?? "";
      const rep = pick(rich ? encodeText(c.to) : c.to);
      return rep === null ? s : `${lead}${rep}${trail}`;
    }
    if (s.length < c.from.length) return s;
    const re = norm(c.from).length >= MIN_CONTAINED ? k.plain : s.includes("<") ? k.standalone : null;
    return re ? replaceCapture(s, re, () => pick(enc(c.to))) : s;
  }
  if (!s.includes("<") || !k.tag || !k.tagTo) return s;
  const to = k.tagTo;
  return replaceCapture(s, k.tag, () => pick(encodeText(to)));
}

function walkStrings(value: unknown, fn: (s: string) => string, skip: Set<string>): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => walkStrings(v, fn, skip));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = (SKIP_KEYS.has(key) && typeof v === "string") || skip.has(key) ? v : walkStrings(v, fn, skip);
    return out;
  }
  return value;
}

/** One design the page is made of: the page itself, or the site's shared header or footer. */
export type SyncDoc<T> = { design: T; role: "page" | "header" | "footer" };

export type SyncInput = {
  /** The page's HTML as the site was created (before the owner's changes). */
  originalHtml: string;
  /** The page's HTML the owner approved in the preview. */
  finalHtml: string;
  /** The design's main colour and the owner's colour; when both are given the design data is recoloured too. */
  accent?: { from: string; to: string };
};

/** The sentence the owner reads when some of their text could not be placed. */
export function unmatchedMessage(unmatched: TextChange[], skipped: number): string | null {
  const n = unmatched.length + skipped;
  if (n <= 0) return null;
  const short = (t: string) => `“${t.length > 36 ? `${t.slice(0, 33).trimEnd()}...` : t}”`;
  const names = unmatched.slice(0, 3).map((c) => short(c.to)).join(", ");
  const head = n === 1 ? "One piece of text couldn't be filled in automatically" : `${n} pieces of text couldn't be filled in automatically`;
  return `${head}${names ? ` (${names}${unmatched.length > 3 ? ", ..." : ""})` : ""}. Open the “Review and edit your pages” step to check ${n === 1 ? "it" : "them"}.`;
}

/**
 * Applies to the design data (the V2 design JSON: pages, meta) the same text, picture, colour and logo changes the approved HTML has
 * over the original. A site's shared header and footer are their own designs, so pass every design the page is made of: a text counts as
 * found when any of them held it. Returns changed copies (in the same order) and what happened; the inputs are not modified.
 * The brand (`designSystem`) is only recoloured here when it is inline; applying the owner's colour to the brand itself is
 * lib/sites/applyLook.ts's job (the Brand page's own mechanism), which also works on a brand kept in storage.
 */
export function syncDesigns<T extends Record<string, unknown>>(docs: SyncDoc<T>[], input: SyncInput): { docs: SyncDoc<T>[]; report: SyncReport } {
  const { changes, skipped } = pairTextChanges(input.originalHtml, input.finalHtml);
  const images = pairImageChanges(input.originalHtml, input.finalHtml);
  const logo = logoChange(input.originalHtml, input.finalHtml);
  let designs = docs.map((d) => JSON.parse(JSON.stringify(d.design)) as Record<string, unknown>);
  const applied = new Set<TextChange>();
  const unmatched: TextChange[] = [];
  const foundImages = new Set<string>();
  let colours = 0;

  const over = (fn: (s: string) => string) => {
    designs = designs.map((d) => walkStrings(d, fn, NOT_TEXT_KEYS) as Record<string, unknown>);
  };

  // 1. Repeated text changed in some places only: each change goes to its own occurrence, only when the data has as many to line up with.
  const nth = changes.filter((c) => c.nth !== undefined);
  for (const c of nth) {
    let found = 0;
    over((s) => { rewrite(s, c, "plain", () => { found++; return null; }); return s; });
    if (found !== c.of) { unmatched.push(c); continue; }
    let seen = 0;
    over((s) => rewrite(s, c, "plain", (to) => (seen++ === c.nth ? to : null)));
    applied.add(c);
  }

  // 2. Text changed everywhere it appears: whole values, spelled any way, inside longer values, standing alone in rich text.
  // Longest first: a whole sentence is replaced as a whole before a shorter piece (the brand name) inside it could be changed on its own.
  const global = changes.filter((c) => c.nth === undefined).sort((x, y) => y.from.length - x.from.length);
  const attempt = (list: TextChange[], place: Place): Set<TextChange> => {
    const hit = new Set<TextChange>();
    for (const c of list) over((s) => rewrite(s, c, place, (to) => { hit.add(c); return to; }));
    return hit;
  };
  for (const c of attempt(global, "plain")) applied.add(c);
  // 3. What is still missing may be a sentence the data keeps as rich text with inline tags.
  const pending = global.filter((c) => !applied.has(c));
  for (const c of attempt(pending, "tags")) applied.add(c);
  // 4. Or the data keeps the pieces in separate fields: replace the pieces one by one.
  for (const c of pending.filter((p) => !applied.has(p))) {
    const leftover = (c.parts ?? []).filter((part) => !attempt([part], "plain").size);
    if (c.parts?.length && !leftover.length) applied.add(c);
    else unmatched.push(...(c.parts?.length && leftover.length < c.parts.length ? leftover : [c]));
  }

  // Pictures (SOL's photos, a swapped logo).
  if (images.length) {
    const byImage = new Map(images.map((c) => [c.from, c.to]));
    over((s) => {
      const to = byImage.get(s);
      if (to === undefined) return s;
      foundImages.add(s);
      return to;
    });
  }

  // The accent colour wherever the data writes it as a hex value (the brand included when it is inline).
  const accent = input.accent;
  if (accent) {
    const recolour = (s: string) => (s.includes("#") ? s.replace(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (hit) => { const next = recolourHex(hit, accent.from, accent.to); if (next !== hit) colours++; return next; }) : s);
    designs = designs.map((d) => walkStrings(d, recolour, new Set()) as Record<string, unknown>);
  }

  // The page's title and search description.
  const meta = metaChanges(input.originalHtml, input.finalHtml);
  const metaApplied = Object.keys(meta).length > 0;
  const pageAt = Math.max(0, docs.findIndex((d) => d.role === "page"));
  if (metaApplied) designs[pageAt] = { ...designs[pageAt], meta: { ...((designs[pageAt].meta as Record<string, unknown> | undefined) ?? {}), ...meta } };

  // A logo that was added, swapped or removed: it lives in the header section (the shared header, or the page's own).
  let logoApplied = false;
  if (logo) {
    const order = [...docs.keys()].sort((x, y) => (docs[x].role === "header" ? 0 : docs[x].role === "page" ? 1 : 2) - (docs[y].role === "header" ? 0 : docs[y].role === "page" ? 1 : 2));
    for (const k of order) {
      const done = withHeaderLogo(designs[k], logo.to);
      if (done.placed) { designs[k] = done.design; logoApplied = true; break; }
    }
  }

  const problems: string[] = [];
  const message = unmatchedMessage(unmatched, skipped);
  if (message) problems.push(message);
  // A swapped logo is carried by the header (above), so it is not a "missed picture" even when no design held its old address.
  const missedImages = images.filter((c) => !foundImages.has(c.from) && !(logoApplied && c.to === logo?.to)).length;
  if (missedImages > 0) problems.push(`${missedImages === 1 ? "A picture" : `${missedImages} pictures`} couldn't be swapped automatically. You can change ${missedImages === 1 ? "it" : "them"} in the editor.`);
  if (logo && !logoApplied) problems.push("Your logo is on the preview, but this design has no header to carry it. Add it on the Brand page.");

  return {
    docs: docs.map((d, k) => ({ role: d.role, design: designs[k] as T })),
    report: { textChanges: changes.length, textsApplied: applied.size, textsSkipped: skipped, imagesApplied: foundImages.size, coloursApplied: colours, metaApplied, logoApplied, unmatched, problems },
  };
}

/** One design (a page with nothing shared around it): the same as syncDesigns with just the page. */
export function syncDesignData<T extends Record<string, unknown>>(design: T, input: SyncInput): { design: T; report: SyncReport } {
  const { docs, report } = syncDesigns([{ design, role: "page" }], input);
  return { design: docs[0].design, report };
}
