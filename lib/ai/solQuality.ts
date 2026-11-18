// SOL's quality gate. Pure and deterministic: takes the compiled page (the stored HTML document, which already
// carries the page's CSS and head tags) and the brief, and returns a scored report of specific, fixable findings.
// lib/ai/solQualityRun.ts runs it after every page-building tool call and lib/ai/solAgent.ts will not let SOL
// say "done" while a must-fix finding is open (bounded rounds). Nothing here talks to a model or the database.
//
// Severity: "must" findings block "done" (placeholders, dead links, unreadable text, a missing brand, no h1 ...);
// "should" findings cost score and are listed, but don't block.

import type { Brief } from "./solBrief";

export type Severity = "must" | "should";
export type Finding = { id: string; severity: Severity; message: string; fix: string };
export type GateReport = {
  score: number;
  passed: boolean;
  findings: Finding[];
  stats: { sections: number; headings: number; images: number; links: number; textPairs: number; worstContrast: number | null; htmlBytes: number };
};
export type GateInput = {
  /** The page's compiled document (draftHtml or compiledHtml). */
  html: string;
  brief?: Pick<Brief, "name" | "colors" | "logo" | "fonts" | "cta" | "language" | "content" | "strataProject" | "brandComponents">;
  /** Paths that exist on the site ("/", "/about" ...). When given, internal links are checked against it. */
  knownRoutes?: string[];
  /** Layout fragments (header/footer) are checked less strictly. */
  kind?: "page" | "layout";
};

// ---------------------------------------------------------------- colour math (WCAG 2.x)

export type Rgba = { r: number; g: number; b: number; a: number };

export function parseColor(input: string | undefined): Rgba | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (v === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (v === "black") return { r: 0, g: 0, b: 0, a: 1 };
  const hex = v.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const fn = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (fn) {
    const a = fn[4] === undefined ? 1 : fn[4].endsWith("%") ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    return { r: +fn[1], g: +fn[2], b: +fn[3], a };
  }
  return null;
}

export function relativeLuminance({ r, g, b }: Pick<Rgba, "r" | "g" | "b">): number {
  const c = [r, g, b].map((x) => x / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: Pick<Rgba, "r" | "g" | "b">, b: Pick<Rgba, "r" | "g" | "b">): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `top` drawn over `under` (both opaque result). */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top.a + under.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, u: number) => Math.round((t * top.a + u * under.a * (1 - top.a)) / a);
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
}

// ---------------------------------------------------------------- a small HTML + CSS reader (for compiler output)

type El = { tag: string; attrs: Record<string, string>; children: El[]; text: string; parent: El | null; classes: string[] };
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

export function parseHtml(html: string): { root: El; head: El; styles: string[]; all: El[] } {
  const root: El = { tag: "#root", attrs: {}, children: [], text: "", parent: null, classes: [] };
  const all: El[] = [];
  const styles: string[] = [];
  let cur = root;
  const re = /<!--[\s\S]*?-->|<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) {
      if (m[1].toLowerCase() === "style") styles.push(m[3]);
      continue;
    }
    if (m[4]) {
      const t = m[4].toLowerCase();
      let n: El | null = cur;
      while (n && n.tag !== t) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    if (m[5]) {
      const tag = m[5].toLowerCase();
      const attrs = parseAttrs(m[6] ?? "");
      const el: El = { tag, attrs, children: [], text: "", parent: cur, classes: (attrs.class ?? "").split(/\s+/).filter(Boolean) };
      cur.children.push(el);
      all.push(el);
      if (!VOID.has(tag) && !m[7]) cur = el;
      continue;
    }
    if (m[8] !== undefined && m[8].trim()) cur.text += decode(m[8]);
  }
  const head = all.find((e) => e.tag === "head") ?? root;
  return { root, head, styles, all };
}

const ownText = (e: El) => e.text.replace(/\s+/g, " ").trim();
const deepText = (e: El): string => [ownText(e), ...e.children.map(deepText)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

type Decls = Record<string, string>;
export function parseCss(css: string): { classRules: Map<string, Decls>; vars: Map<string, string>; keyframes: number; animations: number } {
  const classRules = new Map<string, Decls>();
  const vars = new Map<string, string>();
  let i = 0;
  let keyframes = 0;
  const animations = (css.match(/\banimation(?:-name)?\s*:/g) ?? []).length;
  const readBlock = (start: number): number => {
    let depth = 1;
    let j = start;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    return j;
  };
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    const end = readBlock(open + 1);
    const body = css.slice(open + 1, end - 1);
    i = end;
    if (selector.startsWith("@")) {
      if (/^@keyframes/.test(selector)) keyframes++;
      continue; // media queries and font-face: the base (mobile-first / desktop) rules are what the checks read
    }
    const decls: Decls = {};
    for (const d of body.split(";")) {
      const c = d.indexOf(":");
      if (c === -1) continue;
      decls[d.slice(0, c).trim().toLowerCase()] = d.slice(c + 1).trim();
    }
    for (const sel of selector.split(",").map((s) => s.trim())) {
      if (/^(:where\(:root\)|:root|html|body)$/.test(sel)) {
        for (const [k, v] of Object.entries(decls)) if (k.startsWith("--")) vars.set(k, v);
        continue;
      }
      const m = sel.match(/^\.([\w-]+)$/);
      if (m) classRules.set(m[1], { ...(classRules.get(m[1]) ?? {}), ...decls });
    }
  }
  return { classRules, vars, keyframes, animations };
}

function resolveVars(value: string | undefined, vars: Map<string, string>, depth = 0): string | undefined {
  if (value === undefined || depth > 12) return value;
  let out = value;
  for (let guard = 0; guard < 12 && /var\(/.test(out); guard++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_, name: string, fallback?: string) => {
      const v = vars.get(name);
      return v !== undefined ? v : (fallback ?? "");
    });
  }
  return out.trim() || undefined;
}

// ---------------------------------------------------------------- the checks

const PLACEHOLDER_RES: Array<[RegExp, string]> = [
  [/lorem ipsum|dolor sit amet/i, "Lorem ipsum text"],
  [/your (?:headline|heading|tagline|brand|company name|business name|logo)\b|your (?:text|title|name|company) here\b/i, "A 'Your headline / Your brand here' placeholder"],
  [/welcome to (?:our|my|the) (?:website|site|page)\b/i, "The generic 'Welcome to our website' opener"],
  [/\b(?:john|jane) doe\b/i, "A placeholder person (John/Jane Doe)"],
  [/@example\.(?:com|org)|\byou@|\byour ?email@|name@(?:company|domain)\./i, "A placeholder email address"],
  [/\(?555\)?[-. ]?\d{3,4}|\b123[-. ]?456[-. ]?789\d?|\+?1?[-. ]?234[-. ]?567[-. ]?890\d?|\b0{3,}\b/, "A placeholder phone number"],
  [/\b(?:feature|service|benefit|item|product|plan|step) (?:one|two|three|four|[1-6])\b(?!\s*[:.-]\s*\w)/i, "Numbered filler like 'Service 1'"],
  [/click here to edit|insert (?:text|image|your)|add your (?:text|content|copy)|sample text|your text goes here/i, "Editor placeholder text"],
  [/\bcompany name\b|\bbusiness name\b|\b123 (?:main|street|example)/i, "A placeholder company name or address"],
];
// Wording the page kit ships as starting copy: fine as a start, never fine as the finished page.
const KIT_SAMPLES = [
  "learn the skill that changes everything",
  "no complicated setup. here is what to expect",
  "tell us what you need",
  "loved by the people we work with",
  "amara okafor",
  "founder, brightside bakery",
  "share a few details about your goals",
  "go live with confidence, with help close by",
  "we get to work",
];
const GENERIC_PHRASES = /\b(?:high[- ]quality|best[- ]in[- ]class|world[- ]class|state[- ]of[- ]the[- ]art|cutting[- ]edge|one[- ]stop[- ]shop|we are passionate|tailored solutions|quality services|second to none|take your .{3,30} to the next level|we offer quality|unparalleled)\b/i;

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(" ").length >= 6);
const words = (t: string) => t.split(/\s+/).filter(Boolean);
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function syllables(w: string): number {
  const s = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return 1;
  const m = s.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, m?.length ?? 1);
}
/** Flesch-Kincaid grade of plain text (English); 0 when too short to judge. */
export function readingGrade(text: string): number {
  const ss = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const ws = words(text);
  if (ws.length < 40 || ss.length === 0) return 0;
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59;
}

const toPx = (v: string | undefined, rootPx = 16, vars?: Map<string, string>): number | null => {
  const r = vars ? resolveVars(v, vars) : v;
  if (!r) return null;
  const m = r.trim().match(/^(-?[\d.]+)(px|rem|em)?$/);
  if (!m) return null;
  return m[2] === "px" || !m[2] ? +m[1] : +m[1] * rootPx;
};

export function checkPage(input: GateInput): GateReport {
  const { html, brief } = input;
  const findings: Finding[] = [];
  const add = (id: string, severity: Severity, message: string, fix: string) => findings.push({ id, severity, message, fix });
  const layout = input.kind === "layout";

  const doc = parseHtml(html);
  const css = parseCss(doc.styles.join("\n"));
  const body = doc.all.find((e) => e.tag === "body") ?? doc.root;
  const page = doc.all.find((e) => e.classes.includes("plx-page")) ?? body;
  const sectionEls = page.children.filter((c) => c.tag === "section");
  const isHeaderSec = (e: El) => /header|menu|nav/i.test(e.attrs.id ?? "");
  const isFooterSec = (e: El) => /footer/i.test(e.attrs.id ?? "");
  const bodySections = sectionEls.filter((e) => !isHeaderSec(e) && !isFooterSec(e));
  const visibleText = deepText(body);

  // ---- 1. placeholders and filler
  if (!layout) {
    const hits = new Set<string>();
    for (const [re, label] of PLACEHOLDER_RES) if (re.test(visibleText) || re.test(html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " "))) hits.add(label);
    const lower = visibleText.toLowerCase();
    const supplied = (brief?.content?.headlines ?? []).join(" ").toLowerCase();
    const kit = KIT_SAMPLES.filter((s) => lower.includes(s) && !supplied.includes(s));
    for (const h of hits) add("placeholder", "must", `${h} is still on the page.`, "Replace it with real, specific copy for this business (or remove it).");
    if (kit.length) add("kit-sample-copy", "must", `The page still has the kit's sample wording ("${kit[0]}"${kit.length > 1 ? ` and ${kit.length - 1} more` : ""}).`, "Rewrite every section with this business's own words via page_edit (or pass real content in site_create).");
  }

  // ---- 2. every section has real copy and a job
  if (!layout) {
    const empty = bodySections.filter((s) => words(deepText(s)).length < 4 && !/gallery|logo|map|video|embed|image/i.test(s.attrs.id ?? ""));
    if (empty.length) add("empty-section", "must", `${empty.length} section${empty.length > 1 ? "s have" : " has"} no real copy (${empty.map((s) => s.attrs.id || "unnamed").slice(0, 3).join(", ")}).`, "Fill each section with a specific headline and a line of copy, or remove it.");
    if (bodySections.length < 4 && input.kind !== "layout") add("thin-page", "should", `The page has only ${bodySections.length} content section${bodySections.length === 1 ? "" : "s"}.`, "A finished landing page usually has 6 to 9: hero, proof, how it works or the offer, benefits, pricing or products, FAQ, final call to action.");
  }

  // ---- 3. headings
  const heads = doc.all.filter((e) => /^h[1-6]$/.test(e.tag));
  const h1s = heads.filter((h) => h.tag === "h1");
  if (!layout) {
    if (h1s.length === 0) add("h1-missing", "must", "The page has no main headline (h1).", "Make the hero's headline the page's one h1.");
    if (h1s.length > 1) add("h1-many", "must", `The page has ${h1s.length} main headlines (h1); there should be one.`, "Keep one h1 (the hero) and make the others h2.");
    let prev = 0;
    for (const h of heads) {
      const lvl = +h.tag[1];
      if (prev && lvl > prev + 1) { add("heading-skip", "should", `A heading jumps from h${prev} to h${lvl}.`, "Use h2 for section titles and h3 for items inside them, in order."); break; }
      prev = lvl;
    }
    for (const h of heads) if (!deepText(h)) { add("heading-empty", "must", "A heading is empty.", "Give it text or remove it."); break; }
    const h1w = h1s[0] ? words(deepText(h1s[0])).length : 0;
    if (h1w > 14) add("headline-long", "should", `The main headline is ${h1w} words long.`, "Say the promise in under 10 words.");
    const longH2 = heads.filter((h) => h.tag === "h2" && words(deepText(h)).length > 16);
    if (longH2.length) add("heading-long", "should", `${longH2.length} section title${longH2.length > 1 ? "s are" : " is"} over 16 words.`, "Shorten section titles to one clear line.");
  }

  // ---- 4. calls to action
  const isCta = (e: El) => (e.tag === "a" && e.classes.includes("plx-btn")) || e.tag === "button";
  const ctasIn = (s: El): El[] => [...(isCta(s) ? [s] : []), ...s.children.flatMap(ctasIn)];
  if (!layout && bodySections.length) {
    const hero = bodySections[0];
    const heroCtas = ctasIn(hero).filter((c) => deepText(c));
    if (heroCtas.length === 0) add("cta-hero", "must", "The top of the page has no call-to-action button.", "Add one clear primary button in the hero that says what happens next (e.g. 'Book my free tasting').");
    else if (heroCtas.length > 3) add("cta-many", "should", `The hero has ${heroCtas.length} buttons.`, "Keep one primary button and at most one quiet secondary one.");
    const genericLabels = heroCtas.filter((c) => /^(click here|submit|learn more|read more|more|go|here)$/i.test(deepText(c)));
    if (genericLabels.length) add("cta-vague", "should", "A button says only 'Learn more' or 'Click here'.", "Make button labels say what happens next.");
    if (bodySections.length >= 3) {
      const tail = bodySections.slice(-2);
      if (!tail.some((s) => ctasIn(s).some((c) => deepText(c)))) add("cta-final", "must", "The page doesn't end with a call to action.", "Add a final section that repeats the promise and the same primary button.");
    }
  }

  // ---- 5. images
  const imgs = doc.all.filter((e) => e.tag === "img");
  const slots = doc.all.filter((e) => e.classes.includes("plx-ph"));
  if (!layout) {
    if (slots.length) add("image-slot-empty", "must", `${slots.length} image slot${slots.length > 1 ? "s are" : " is"} empty (a grey box).`, "Fill each with a real image (use_attached_image for the owner's own photos), or remove the picture from that section.");
    if (doc.all.some((e) => e.classes.includes("plx-empty"))) add("empty-block", "must", "A section shows an empty 'add something here' box.", "Fill it or remove it.");
  }
  const noAlt = imgs.filter((i) => i.attrs.alt === undefined);
  if (noAlt.length) add("img-alt-missing", "must", `${noAlt.length} image${noAlt.length > 1 ? "s have" : " has"} no alt text.`, "Add a short, specific description to each image.");
  const badSrc = imgs.filter((i) => !i.attrs.src || /^(#|about:blank|undefined|null)$/i.test(i.attrs.src) || /(?:placeholder|placehold\.co|via\.placeholder|dummyimage|lorempixel|picsum)/i.test(i.attrs.src) || /private\/sol-attachments/.test(i.attrs.src));
  if (badSrc.length) add("img-broken", "must", `${badSrc.length} image${badSrc.length > 1 ? "s point" : " points"} nowhere or at a placeholder or private file.`, "Use a real, public image address (use_attached_image for chat attachments) or remove it.");
  const roleImgNoLabel = doc.all.filter((e) => e.attrs.role === "img" && !e.attrs["aria-label"] && !e.classes.includes("plx-ph"));
  if (roleImgNoLabel.length) add("img-label", "should", "A picture has no accessible label.", "Give it an aria-label or alt text.");

  // ---- 6. colour contrast: every text colour on its real background (from the compiled CSS)
  const stats = { pairs: 0, worst: null as number | null };
  const failing: Array<{ ratio: number; text: string; fg: string; bg: string; large: boolean }> = [];
  const declsOf = (e: El): Decls => {
    const d: Decls = {};
    for (const c of e.classes) Object.assign(d, css.classRules.get(c) ?? {});
    if (e.attrs.style) for (const part of e.attrs.style.split(";")) { const k = part.indexOf(":"); if (k > 0) d[part.slice(0, k).trim().toLowerCase()] = part.slice(k + 1).trim(); }
    return d;
  };
  const rootFg = parseColor(resolveVars("var(--color-text-primary)", css.vars)) ?? { r: 28, g: 25, b: 23, a: 1 };
  const rootBg = parseColor(resolveVars("var(--color-bg-surface)", css.vars)) ?? { r: 255, g: 255, b: 255, a: 1 };
  const fgOf = (e: El | null): Rgba => {
    for (let n = e; n; n = n.parent) {
      const c = declsOf(n).color;
      if (c) {
        const p = parseColor(resolveVars(c, css.vars));
        if (p && c.trim() !== "inherit") return p;
      }
    }
    return rootFg;
  };
  const bgOf = (e: El | null): Rgba | "unknown" => {
    let layers: Rgba[] = [];
    for (let n = e; n; n = n.parent) {
      const d = declsOf(n);
      const raw = d["background-color"] ?? d.background;
      if (raw) {
        const r = resolveVars(raw, css.vars) ?? "";
        if (/gradient|url\(/i.test(r) && !d["background-color"]) return "unknown";
        const first = r.split(/\s+/)[0];
        const c = parseColor(r) ?? parseColor(first);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 0.98) break;
        } else if (!c && d["background-color"] === undefined && /gradient|url\(/i.test(r)) return "unknown";
      }
    }
    let acc: Rgba = rootBg;
    for (const l of layers.reverse()) acc = composite(l, acc);
    return acc;
  };
  for (const e of doc.all) {
    if (!ownText(e) || /^(script|style|title|head|html|body|option)$/.test(e.tag)) continue;
    const text = ownText(e);
    if (text.length < 2) continue;
    const fg = fgOf(e);
    const bg = bgOf(e);
    if (bg === "unknown") continue;
    const effFg = fg.a < 1 ? composite(fg, bg) : fg;
    const ratio = contrastRatio(effFg, bg);
    stats.pairs++;
    stats.worst = stats.worst === null ? ratio : Math.min(stats.worst, ratio);
    const d = declsOf(e);
    const size = toPx(d["font-size"], 16, css.vars) ?? (/^h[1-3]$/.test(e.tag) ? 24 : 16);
    const bold = /^(600|700|800|900|bold)$/.test(resolveVars(d["font-weight"], css.vars) ?? "") || /^h[1-6]$/.test(e.tag);
    const large = size >= 24 || (size >= 18.66 && bold);
    if (ratio < (large ? 3 : 4.5)) failing.push({ ratio, text: text.slice(0, 40), fg: toHex(effFg), bg: toHex(bg), large });
  }
  if (failing.length) {
    failing.sort((a, b) => a.ratio - b.ratio);
    const w = failing[0];
    add("contrast", "must", `${failing.length} piece${failing.length > 1 ? "s" : ""} of text are hard to read (WCAG AA): "${w.text}" is ${w.fg} on ${w.bg}, contrast ${w.ratio.toFixed(1)}:1, needs ${w.large ? "3" : "4.5"}:1.`, "Give that text a darker colour (page_edit updateElement style.textColor, e.g. var(--color-text-secondary) or var(--color-text-primary)) or lighten/darken its section background. Body text needs 4.5:1.");
  }

  // ---- 7. the owner's brand is really applied
  if (brief && !layout) {
    const cssText = doc.styles.join("\n").toLowerCase();
    const wanted = (brief.colors?.value ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
    if (brief.colors?.status === "known" && wanted.length) {
      const miss = wanted.filter((c) => !cssText.includes(c.toLowerCase()));
      // A page of a site linked to a Strata brand may take its main colour from the brand's variables (the hosted sheet defines them).
      const usesBrandVar = !!brief.strataProject && /var\(--(?:color-action-primary-bg|color-brand-primary(?:-\d+)?|plx-accent)\b/.test(cssText + " " + html.toLowerCase());
      if (!cssText.includes(wanted[0].toLowerCase()) && !usesBrandVar) add("brand-colour", "must", `The owner's main colour ${wanted[0]} isn't used anywhere on the page.`, `Apply it with setBrand (primaryColor ${wanted[0]}) so buttons and accents use it.`);
      else if (miss.length) add("brand-colour-2", "should", `The owner's colour${miss.length > 1 ? "s" : ""} ${miss.join(", ")} isn't used.`, "Use it as the secondary colour or a background.");
    }
    const name = brief.name?.status === "known" ? brief.name.value : undefined;
    if (name) {
      if (!norm(visibleText).includes(norm(name))) add("brand-name", "must", `The business name "${name}" doesn't appear on the page.`, "Put the name in the header (as the logo or wordmark) and the footer.");
      else {
        const loose = new RegExp(name.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/, "(?:&|and)")).join("[\\s\\-]*"), "gi");
        const variants = new Set((visibleText.match(loose) ?? []).filter((m) => m !== name && norm(m) === norm(name)));
        if (variants.size) add("brand-name-spelling", "must", `The business name is spelled differently in places ("${[...variants][0]}" vs "${name}").`, `Use exactly "${name}" everywhere.`);
      }
      const header = sectionEls.find(isHeaderSec) ?? sectionEls[0];
      if (header && (brief.logo?.value === "none" || brief.logo?.status === "missing") && !norm(deepText(header)).includes(norm(name)) && !header.children.length) add("wordmark", "should", "There's no logo and no wordmark in the header.", "Set the business name as a clean wordmark in the header.");
    }
    if (brief.logo?.status === "known" && (brief.logo.value === "uploaded" || brief.logo.value === "link")) {
      const header = sectionEls.find(isHeaderSec) ?? sectionEls[0];
      const hasLogo = !!header && (function find(e: El): boolean { return e.tag === "img" || e.children.some(find); })(header);
      if (!hasLogo) add("brand-logo", "must", "The owner's logo isn't in the header.", "Place their logo image in the header (use_attached_image gives a public address for an attached file).");
    }
    // The brand's ready-made components come first: a button or card made by hand on a site whose brand has one is a nudge, never a failure.
    const brandComps = new Set((brief.brandComponents ?? []).map((n) => n.toLowerCase()));
    const usesBrandComponent = (n: string) => doc.all.some((e) => e.classes.some((c) => c === `plx-brand-${n}` || c.startsWith(`plx-brand-${n}--`)));
    const looksLike: Record<string, (e: El) => boolean> = {
      button: (e) => e.tag === "button" || (e.tag === "a" && e.classes.some((c) => /^(btn|button|cta)\b|(?:^|-)(btn|button)(?:-|$)/i.test(c))),
      card: (e) => e.classes.some((c) => /(?:^|-)card(?:-|$)/i.test(c)),
    };
    for (const kind of ["button", "card"]) {
      if (brandComps.has(kind) && !usesBrandComponent(kind) && doc.all.some(looksLike[kind])) {
        add(`brand-component-${kind}`, "should", `A ${kind} was built by hand, but the owner's brand already has its own ${kind}.`, `Use the brand's ${kind} (class plx-brand-${kind}, from the brand sheet) instead of inventing one, and say "I'll use your brand's ${kind}".`);
      }
    }
    const fonts = (brief.fonts?.value ?? "").split(" + ").filter(Boolean);
    const fontHtml = (html + doc.styles.join(" ")).toLowerCase();
    const missingFonts = fonts.filter((f) => !fontHtml.includes(f.toLowerCase().replace(/ /g, "+")) && !fontHtml.includes(f.toLowerCase()));
    if (brief.fonts?.status === "known" && missingFonts.length) add("brand-fonts", "should", `The owner's font${missingFonts.length > 1 ? "s" : ""} ${missingFonts.join(", ")} aren't applied.`, "Set them with setBrand (headingFont, bodyFont).");
  }

  // ---- 8. title, description, social
  if (!layout) {
    const metas = doc.all.filter((e) => e.tag === "meta");
    const meta = (k: string, v: string) => metas.find((m) => (m.attrs[k] ?? "").toLowerCase() === v)?.attrs.content ?? "";
    const title = doc.all.find((e) => e.tag === "title");
    const t = title ? deepText(title) || ownText(title) : "";
    const nameN = norm(brief?.name?.value ?? "");
    if (!t || /^(untitled|home|page|landing page|new page|my website|website)$/i.test(t.trim())) add("seo-title", "must", "The page has no specific title.", "Set a title of 30 to 60 characters that says what the business does and where (page meta htmlTitle).");
    else if (t.length > 70 || (nameN && norm(t) === nameN)) add("seo-title-quality", "should", t.length > 70 ? `The page title is ${t.length} characters (search shows about 60).` : "The page title is only the business name.", "Say what they do: 'Sourdough and celebration cakes in Accra | Crumb & Co'.");
    const desc = meta("name", "description");
    if (!desc) add("seo-description", "must", "The page has no search description.", "Set a 70 to 160 character description that says what they offer and the next step (meta metaDescription).");
    else if (desc.length < 50 || desc.length > 175) add("seo-description-length", "should", `The search description is ${desc.length} characters (aim for 70 to 160).`, "Rewrite it to 70-160 characters.");
    if (desc && !meta("property", "og:title")) add("og-title", "should", "No social-share title.", "Set the page's title so it also fills the social-share fields.");
    if (!meta("property", "og:image")) add("og-image", "should", "No social-share image.", "Set an og image (the logo or a hero photo) so links look good when shared.");
  }

  // ---- 9. links
  const anchors = doc.all.filter((e) => e.tag === "a");
  const ids = new Set(doc.all.map((e) => e.attrs.id).filter(Boolean));
  const routes = input.knownRoutes ? new Set(input.knownRoutes.map((r) => r.replace(/\/+$/, "") || "/")) : null;
  const dead: string[] = [];
  const badAnchors: string[] = [];
  const badPaths: string[] = [];
  const badContact: string[] = [];
  for (const a of anchors) {
    const href = (a.attrs.href ?? "").trim();
    const label = deepText(a) || a.attrs["aria-label"] || "";
    if (a.attrs.href === undefined) { if (label) dead.push(label); continue; }
    if (href === "" || href === "#" || /^javascript:/i.test(href)) dead.push(label || href || "(link)");
    else if (href.startsWith("#")) { if (!ids.has(href.slice(1))) badAnchors.push(href); }
    else if (/^mailto:/i.test(href)) { if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+(?:\?.*)?$/i.test(href) || /example\.(com|org)/i.test(href)) badContact.push(href); }
    else if (/^tel:/i.test(href)) { const digits = href.replace(/\D/g, ""); if (!/^tel:\+?[\d\s().-]{7,20}$/i.test(href) || /555\d{4}$|^(\d)\1{6,}$|123456789/.test(digits)) badContact.push(href); }
    else if (/^https?:\/\//i.test(href)) { if (/example\.(com|org)|yourdomain|localhost/i.test(href)) badContact.push(href); }
    else if (href.startsWith("/") && !href.startsWith("//") && routes) {
      const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
      if (!routes.has(path) && !/^\/(api|blog|store|product|checkout|order)/.test(path)) badPaths.push(href);
    }
  }
  if (dead.length) add("link-dead", "must", `${dead.length} link${dead.length > 1 ? "s go" : " goes"} nowhere ("${dead[0]}").`, "Point each button at a real page, a section on the page, or remove it.");
  if (badAnchors.length) add("link-anchor", "must", `${badAnchors.length} link${badAnchors.length > 1 ? "s jump" : " jumps"} to a section that doesn't exist (${badAnchors.slice(0, 2).join(", ")}).`, "Link to a section that exists on the page, or give that section the matching id.");
  if (badPaths.length) add("link-page", "must", `${badPaths.length} link${badPaths.length > 1 ? "s point" : " points"} to a page that doesn't exist on this site (${badPaths.slice(0, 2).join(", ")}).`, "Link to a page the site really has (or create the page first).");
  if (badContact.length) add("link-contact", "must", `A contact link looks wrong or like a placeholder (${badContact[0]}).`, "Use the owner's real email (mailto:) or phone (tel:) or remove it.");

  // ---- 10. forms
  const forms = doc.all.filter((e) => e.tag === "form");
  for (const f of forms) {
    const action = (f.attrs.action ?? "").trim();
    if (!action || action === "#") { add("form-destination", "must", "A form has nowhere to send its messages.", "Wire the form to the site's inbox (set_form_destinations) before finishing."); break; }
  }
  for (const f of forms) {
    const hasInput = doc.all.some((e) => /^(input|textarea|select)$/.test(e.tag) && (function inside(x: El | null): boolean { return !!x && (x === f || inside(x.parent)); })(e));
    const hasSubmit = doc.all.some((e) => (e.tag === "button" || (e.tag === "input" && e.attrs.type === "submit")) && (function inside(x: El | null): boolean { return !!x && (x === f || inside(x.parent)); })(e));
    if (!hasInput || !hasSubmit) { add("form-incomplete", "must", "A form is missing its fields or its send button.", "Give the form its fields and a clear send button."); break; }
  }
  const ctaLabel = (brief?.cta?.value ?? "").toLowerCase();
  if (!layout && /book|quote|get in touch|contact|sign up|subscribe|donate/.test(ctaLabel) && forms.length === 0 && !anchors.some((a) => /^(mailto|tel):/i.test(a.attrs.href ?? "") || /^https?:/i.test(a.attrs.href ?? "") || (a.attrs.href ?? "").startsWith("#"))) {
    add("cta-destination", "should", `The main action ("${brief?.cta?.value}") has no form or contact link to complete it.`, "Add a short form (name, email, message) or a contact link the main button leads to.");
  }

  // ---- 11. mobile sanity
  const wide: string[] = [];
  const tiny: string[] = [];
  const smallTargets: string[] = [];
  for (const [cls, d] of css.classRules) {
    const w = d.width && /^\d+(\.\d+)?px$/.test(d.width) ? parseFloat(d.width) : 0;
    if (w > 480 && !/max-width/.test(Object.keys(d).join(" "))) wide.push(cls);
    const fs = toPx(d["font-size"], 16, css.vars);
    if (fs !== null && fs < 12) tiny.push(cls);
  }
  for (const e of doc.all) {
    if (!isCta(e) || !deepText(e)) continue;
    const d = declsOf(e);
    const fs = toPx(d["font-size"], 16, css.vars) ?? 16;
    const pad = (v?: string) => { const parts = (resolveVars(v, css.vars) ?? "").split(/\s+/).map((p) => toPx(p, 16)); return parts.filter((x): x is number => x !== null); };
    const p = pad(d.padding);
    const padY = d["padding-top"] ? (toPx(d["padding-top"], 16, css.vars) ?? 0) + (toPx(d["padding-bottom"], 16, css.vars) ?? 0) : p.length ? (p[0] ?? 0) * 2 : 0;
    const explicit = toPx(d["min-height"] ?? d.height, 16, css.vars);
    const h = explicit ?? fs * 1.25 + padY;
    if (padY > 0 || explicit !== null) { if (h < 44) smallTargets.push(deepText(e)); }
  }
  if (!layout) {
    if (wide.length) add("mobile-fixed-width", "should", `${wide.length} element${wide.length > 1 ? "s have" : " has"} a fixed width over 480px, which overflows on phones.`, "Use a percentage or max-width instead of a fixed width.");
    if (tiny.length) add("mobile-small-text", "should", "Some text is smaller than 12px.", "Keep body text at 16px (14px at the very least).");
    if (smallTargets.length) add("mobile-tap-target", "should", `A button ("${smallTargets[0]}") is shorter than 44px, hard to tap on a phone.`, "Give buttons at least 44px of height (more padding).");
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) add("mobile-viewport", "must", "The page has no mobile viewport setting.", "Re-save the page; the viewport tag is added by the builder.");
  }

  // ---- 12. spacing rhythm
  if (!layout && bodySections.length >= 4) {
    const pads = new Set<number>();
    for (const s of bodySections) {
      const d = declsOf(s);
      const v = toPx(d["padding-top"] ?? (d.padding ?? "").split(/\s+/)[0], 16, css.vars);
      if (v !== null) pads.add(Math.round(v));
    }
    if (pads.size > 3) add("spacing", "should", `Sections use ${pads.size} different vertical spacings.`, "Use one consistent section spacing (the page's default) so it has a steady rhythm.");
  }

  // ---- 13. copy quality
  if (!layout) {
    const pText = doc.all.filter((e) => e.tag === "p").map(ownText).join(" ");
    const seen = new Map<string, number>();
    for (const s of sentences(visibleText)) seen.set(norm(s), (seen.get(norm(s)) ?? 0) + 1);
    const dup = [...seen].filter(([, n]) => n > 1);
    if (dup.length) add("copy-repeat", "should", `The same sentence appears more than once ("${dup[0][0].slice(0, 50)}...").`, "Write each section's copy fresh; don't repeat sentences.");
    const generic = visibleText.match(GENERIC_PHRASES);
    if (generic) add("copy-generic", "should", `Generic marketing filler ("${generic[0]}").`, "Replace it with a concrete detail: a number, a place, a time, a named product.");
    if (!brief?.language?.value || brief.language.value === "English") {
      const g = readingGrade(pText);
      if (g > 10.5) add("copy-reading-level", "should", `The copy reads at about grade ${g.toFixed(0)}; most visitors read comfortably at 8 or lower.`, "Use shorter sentences and everyday words.");
    }
    const filler = heads.filter((h) => /^\s*(?:feature|service|benefit|item|step|option)\s*\d?\s*$/i.test(deepText(h)));
    if (filler.length) add("copy-filler-heading", "must", "A heading is just 'Feature' or 'Service'.", "Name the real feature or service and say what the visitor gets.");
  }

  // ---- 14. weight and motion
  const bytes = Buffer.byteLength(html, "utf8");
  const dataImgs = (html.match(/src="data:image\/[^"]{150000,}"/g) ?? []).length;
  if (bytes > 900_000) add("weight", "must", `The page is ${(bytes / 1e6).toFixed(1)} MB of code.`, "Use image addresses from the media library instead of embedding big images; remove repeated sections.");
  else if (bytes > 350_000 || dataImgs) add("weight-heavy", "should", dataImgs ? "Large images are embedded in the page." : `The page is ${(bytes / 1000).toFixed(0)} KB of code.`, "Use hosted images, not embedded ones, so it loads fast on phones.");
  if (imgs.length > 40) add("weight-images", "should", `${imgs.length} images on one page.`, "Keep it to the images that earn their place.");
  if (css.keyframes + css.animations > 8) add("motion", "should", "There's a lot of motion on the page.", "Keep animation to one or two gentle effects.");

  const must = findings.filter((f) => f.severity === "must").length;
  const should = findings.length - must;
  const score = Math.max(0, 100 - must * 12 - should * 4);
  return {
    score,
    passed: must === 0,
    findings,
    stats: { sections: sectionEls.length, headings: heads.length, images: imgs.length + slots.length, links: anchors.length, textPairs: stats.pairs, worstContrast: stats.worst === null ? null : Math.round(stats.worst * 100) / 100, htmlBytes: bytes },
  };
}

const toHex = (c: Rgba) => `#${[c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** The report as feedback for SOL: specific, ordered must-first, in words it can act on (and not repeat to the owner). */
export function formatGateFeedback(report: GateReport, o: { round: number; maxRounds: number; pageName?: string }): string {
  const must = report.findings.filter((f) => f.severity === "must");
  const should = report.findings.filter((f) => f.severity === "should");
  const head = report.passed
    ? `Quality check${o.pageName ? ` for "${o.pageName}"` : ""}: PASSED (${report.score}/100).${should.length ? " Nice-to-fix items below; fix the quick ones if you're editing anyway." : ""}`
    : `Quality check${o.pageName ? ` for "${o.pageName}"` : ""}: NOT DONE YET (${report.score}/100, round ${o.round} of ${o.maxRounds}). Fix every MUST item with page_edit (or the right tool), then the page is checked again. Don't tell the owner it's finished until this passes.`;
  const lines = [head];
  if (must.length) lines.push("MUST FIX:", ...must.map((f) => `- ${f.message} Fix: ${f.fix}`));
  if (should.length) lines.push("SHOULD FIX:", ...should.slice(0, 6).map((f) => `- ${f.message} Fix: ${f.fix}`));
  return lines.join("\n");
}
