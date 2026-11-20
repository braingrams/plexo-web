/**
 * A small, position-aware reader for a page's HTML, so the Design view (click a word, picture or link and change it)
 * can write the change back into the page's own HTML WITHOUT rewriting the rest of it.
 *
 * It never builds a new document from a tree (that is what makes round trips lossy: quotes, spacing, entities, unclosed
 * tags and comments all get "normalised"). It only finds where things sit in the original text, so an edit replaces
 * exactly those few characters and every other byte stays as written. Pure (no DOM), so the same code runs in the
 * browser and in tests (tests/htmlSource.test.ts).
 *
 * It also reports the structural problems it meets on the way (an unclosed tag, a stray closing tag, an unfinished
 * quote); htmlLint.ts turns those into plain-language hints for the Code view.
 */

export type SrcAttr = {
  name: string;
  /** Lower-case name, for matching. */
  lname: string;
  /** The value exactly as written (still escaped), or null for a bare attribute like `disabled`. */
  value: string | null;
  /** Whole attribute, `name="value"`. */
  start: number;
  end: number;
  /** Just the value, without its quotes (equal when there is no value). */
  valueStart: number;
  valueEnd: number;
  quote: '"' | "'" | "";
};

export type SrcText = { start: number; end: number };

export type SrcElement = {
  /** Position in the page, counting every start tag from the top (the id the Design view uses). */
  index: number;
  /** Lower-case tag name. */
  name: string;
  /** Where `<` of the opening tag is, and where the opening tag ends (just after `>`). */
  start: number;
  tagEnd: number;
  attrs: SrcAttr[];
  selfClosing: boolean;
  void: boolean;
  /** Index of the element this one sits in, or -1. */
  parent: number;
  /** Where its closing tag starts, or null when it has none (void elements, or never closed). */
  closeStart: number | null;
  /** Words written directly inside it (not inside a child element). Empty for script/style. */
  texts: SrcText[];
  childCount: number;
  /** script/style/textarea/title: the content is code or raw text, not page words. */
  rawText: boolean;
};

export type SrcIssueKind = "unclosed" | "stray-close" | "mismatch" | "unclosed-tag" | "unclosed-quote" | "unclosed-comment" | "duplicate-attr";

export type SrcIssue = {
  kind: SrcIssueKind;
  /** The span in the page to point at. */
  from: number;
  to: number;
  /** The tag the problem is about (lower-case), when there is one. */
  tag?: string;
  /** For "mismatch": the tag that was open when the wrong closing tag arrived. */
  expected?: string;
  attr?: string;
};

export type SrcDoc = { html: string; elements: SrcElement[]; issues: SrcIssue[] };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
/** Tags a browser closes by itself, so a missing end tag is normal for them. */
export const OPTIONAL_END = new Set(["html", "head", "body", "p", "li", "dt", "dd", "tr", "td", "th", "thead", "tbody", "tfoot", "colgroup", "option", "optgroup", "rb", "rt", "rp"]);
const BLOCK_CLOSES_P = new Set(["address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul"]);

const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

export function parseSource(html: string): SrcDoc {
  const elements: SrcElement[] = [];
  const issues: SrcIssue[] = [];
  const stack: number[] = [];
  const n = html.length;
  let pos = 0;

  const top = () => (stack.length ? stack[stack.length - 1] : -1);
  const addText = (start: number, end: number) => {
    if (end <= start) return;
    const t = top();
    if (t >= 0 && !elements[t].rawText) elements[t].texts.push({ start, end });
  };
  const closeTop = () => {
    stack.pop();
  };

  while (pos < n) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) {
      addText(pos, n);
      break;
    }
    if (lt > pos) addText(pos, lt);

    // Comments.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) {
        issues.push({ kind: "unclosed-comment", from: lt, to: n });
        pos = n;
      } else pos = end + 3;
      continue;
    }
    // <!doctype>, <![CDATA[ ]]>, <?xml ?>
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt + 2);
      pos = end === -1 ? n : end + 1;
      continue;
    }
    // Closing tag.
    if (html[lt + 1] === "/") {
      const m = /^<\/([a-zA-Z][^\s/>]*)[^>]*>?/.exec(html.slice(lt, lt + 200));
      if (!m) {
        // "</" followed by something that is not a tag name: plain text.
        addText(lt, lt + 2);
        pos = lt + 2;
        continue;
      }
      const name = m[1].toLowerCase();
      const tagEnd = lt + m[0].length;
      let found = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (elements[stack[i]].name === name) {
          found = i;
          break;
        }
      }
      if (found === -1) {
        issues.push({ kind: "stray-close", from: lt, to: tagEnd, tag: name });
      } else {
        // Anything still open inside it gets closed here: fine for tags with optional ends, a mistake for the rest.
        for (let i = stack.length - 1; i > found; i--) {
          const inner = elements[stack[i]];
          if (!OPTIONAL_END.has(inner.name)) issues.push({ kind: "mismatch", from: inner.start, to: inner.tagEnd, tag: inner.name, expected: name });
        }
        elements[stack[found]].closeStart = lt;
        stack.length = found;
      }
      pos = tagEnd;
      continue;
    }
    // Start tag.
    const nm = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 120));
    if (!nm) {
      // A lone "<" is text.
      addText(lt, lt + 1);
      pos = lt + 1;
      continue;
    }
    const name = nm[1].toLowerCase();
    let i = lt + nm[0].length;
    const attrs: SrcAttr[] = [];
    let selfClosing = false;
    let tagEnd = -1;
    let brokenQuote = false;
    while (i < n) {
      while (i < n && isSpace(html[i])) i++;
      if (i >= n) break;
      if (html[i] === ">") {
        tagEnd = i + 1;
        break;
      }
      if (html[i] === "/") {
        if (html[i + 1] === ">") {
          selfClosing = true;
          tagEnd = i + 2;
          break;
        }
        i++;
        continue;
      }
      const aStart = i;
      while (i < n && !isSpace(html[i]) && html[i] !== "=" && html[i] !== ">" && !(html[i] === "/" && html[i + 1] === ">")) i++;
      const aName = html.slice(aStart, i);
      let j = i;
      while (j < n && isSpace(html[j])) j++;
      if (html[j] === "=") {
        j++;
        while (j < n && isSpace(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, j + 1);
          if (close === -1) {
            issues.push({ kind: "unclosed-quote", from: aStart, to: Math.min(n, aStart + aName.length + 2), tag: name, attr: aName });
            i = n;
            brokenQuote = true;
            break;
          }
          attrs.push({ name: aName, lname: aName.toLowerCase(), value: html.slice(j + 1, close), start: aStart, end: close + 1, valueStart: j + 1, valueEnd: close, quote: q });
          i = close + 1;
        } else {
          const vStart = j;
          while (j < n && !isSpace(html[j]) && html[j] !== ">") j++;
          attrs.push({ name: aName, lname: aName.toLowerCase(), value: html.slice(vStart, j), start: aStart, end: j, valueStart: vStart, valueEnd: j, quote: "" });
          i = j;
        }
      } else {
        attrs.push({ name: aName, lname: aName.toLowerCase(), value: null, start: aStart, end: i, valueStart: i, valueEnd: i, quote: "" });
      }
    }
    if (tagEnd === -1) {
      if (!brokenQuote) issues.push({ kind: "unclosed-tag", from: lt, to: Math.min(n, lt + nm[0].length), tag: name });
      pos = n;
      break;
    }
    const seen = new Set<string>();
    for (const a of attrs) {
      if (seen.has(a.lname)) issues.push({ kind: "duplicate-attr", from: a.start, to: a.end, tag: name, attr: a.lname });
      seen.add(a.lname);
    }

    // Tags a browser would close because this one starts.
    const t = top();
    if (t >= 0) {
      const tn = elements[t].name;
      if ((tn === "p" && BLOCK_CLOSES_P.has(name)) || (tn === "li" && name === "li") || ((tn === "dt" || tn === "dd") && (name === "dt" || name === "dd")) || ((tn === "td" || tn === "th") && (name === "td" || name === "th" || name === "tr")) || (tn === "tr" && (name === "tr" || name === "tbody" || name === "tfoot")) || (tn === "option" && (name === "option" || name === "optgroup"))) {
        closeTop();
      }
    }

    const isVoid = VOID.has(name);
    const idx = elements.length;
    const parent = top();
    const el: SrcElement = { index: idx, name, start: lt, tagEnd, attrs, selfClosing, void: isVoid, parent, closeStart: null, texts: [], childCount: 0, rawText: RAW_TEXT.has(name) };
    elements.push(el);
    if (parent >= 0) elements[parent].childCount++;
    pos = tagEnd;

    if (isVoid || selfClosing) continue;
    if (el.rawText) {
      const re = new RegExp(`</${name}\\s*>`, "i");
      const m = re.exec(html.slice(pos));
      if (!m) {
        issues.push({ kind: "unclosed", from: lt, to: tagEnd, tag: name });
        pos = n;
      } else {
        el.closeStart = pos + m.index;
        pos = pos + m.index + m[0].length;
      }
      continue;
    }
    stack.push(idx);
  }

  for (const i of stack) {
    const el = elements[i];
    if (!OPTIONAL_END.has(el.name)) issues.push({ kind: "unclosed", from: el.start, to: el.tagEnd, tag: el.name });
  }
  return { html, elements, issues };
}

/** Which element each of these is inside, outermost first (not including itself). */
export function ancestorsOf(doc: SrcDoc, index: number): SrcElement[] {
  const out: SrcElement[] = [];
  for (let p = doc.elements[index]?.parent ?? -1; p >= 0; p = doc.elements[p].parent) out.unshift(doc.elements[p]);
  return out;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", middot: "·", bull: "•", trade: "™" };

/** Page text as a person reads it (`&amp;` becomes `&`). Unknown names are left alone. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return all;
      try {
        return String.fromCodePoint(code);
      } catch {
        return all;
      }
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

export const encodeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function encodeAttr(s: string, quote: '"' | "'" | ""): string {
  const base = s.replace(/&/g, "&amp;");
  if (quote === "'") return base.replace(/'/g, "&#39;");
  return base.replace(/"/g, "&quot;");
}

export type ElementInfo = {
  index: number;
  tag: string;
  /** What kind of change makes sense: a picture, some words, or nothing a person can change here. */
  kind: "image" | "text" | "other";
  /** The words directly inside, one entry per run of text (whitespace around it is kept untouched when changed). */
  texts: { id: number; text: string }[];
  image: { src: string; alt: string } | null;
  /** The link this sits in (or is), if any. */
  link: { elementIndex: number; href: string } | null;
  /** Tag name of the closest friendly label, e.g. "Heading". */
  label: string;
};

function attrOf(el: SrcElement, name: string): SrcAttr | undefined {
  return el.attrs.find((a) => a.lname === name);
}
const attrValue = (el: SrcElement, name: string): string => decodeEntities(attrOf(el, name)?.value ?? "");

export function labelForTag(tag: string, inNav: boolean): string {
  if (/^h[1-6]$/.test(tag)) return "Heading";
  if (tag === "img") return "Picture";
  if (tag === "button") return "Button";
  if (tag === "a") return inNav ? "Menu item" : "Link";
  if (tag === "li") return inNav ? "Menu item" : "List item";
  if (tag === "label") return "Form label";
  if (tag === "th") return "Table heading";
  if (tag === "td") return "Table cell";
  if (tag === "blockquote") return "Quote";
  if (tag === "figcaption") return "Caption";
  return "Text";
}

export function describeElement(doc: SrcDoc, index: number): ElementInfo | null {
  const el = doc.elements[index];
  if (!el) return null;
  const chain = [...ancestorsOf(doc, index), el];
  const linkEl = [...chain].reverse().find((e) => e.name === "a");
  const link = linkEl ? { elementIndex: linkEl.index, href: attrValue(linkEl, "href") } : null;
  const inNav = chain.some((e) => e.name === "nav");
  const texts = el.texts
    .map((t, id) => ({ id, text: decodeEntities(doc.html.slice(t.start, t.end)).trim() }))
    .filter((t) => t.text.length > 0);
  if (el.name === "img") {
    return { index, tag: el.name, kind: "image", texts: [], image: { src: attrValue(el, "src"), alt: attrValue(el, "alt") }, link, label: "Picture" };
  }
  if (el.rawText || chain.some((e) => e.name === "svg" || e.name === "head" || e.name === "script" || e.name === "style")) {
    return { index, tag: el.name, kind: "other", texts: [], image: null, link, label: labelForTag(el.name, inNav) };
  }
  return { index, tag: el.name, kind: texts.length > 0 ? "text" : "other", texts, image: null, link, label: labelForTag(el.name, inNav) };
}

export type ElementEdit = {
  /** New words for the text runs listed in `describeElement().texts`, by id. */
  texts?: { id: number; text: string }[];
  /** New destination for the link the element sits in. */
  href?: string;
  src?: string;
  alt?: string;
};

type Replacement = { start: number; end: number; text: string };

function attrReplacement(el: SrcElement, name: string, value: string): Replacement {
  const a = attrOf(el, name);
  if (a) {
    if (a.value === null || a.quote === "") {
      // `disabled` or an unquoted value: write it back quoted so spaces and quotes in the new value are safe.
      return { start: a.start, end: a.end, text: `${a.name}="${encodeAttr(value, '"')}"` };
    }
    return { start: a.valueStart, end: a.valueEnd, text: encodeAttr(value, a.quote) };
  }
  // Not there yet: add it right after the tag name.
  return { start: el.start + 1 + el.name.length, end: el.start + 1 + el.name.length, text: ` ${name}="${encodeAttr(value, '"')}"` };
}

/** Writes the change into the page's own text. Only the characters that change are touched. */
export function applyElementEdit(html: string, index: number, edit: ElementEdit, doc: SrcDoc = parseSource(html)): string {
  const el = doc.elements[index];
  if (!el) return html;
  const reps: Replacement[] = [];
  for (const t of edit.texts ?? []) {
    const run = el.texts[t.id];
    if (!run) continue;
    const raw = html.slice(run.start, run.end);
    // Same words as before: leave the page's own spelling (entities and all) exactly as it is.
    if (decodeEntities(raw).trim() === t.text) continue;
    const lead = /^\s*/.exec(raw)![0];
    const trail = /\s*$/.exec(raw.slice(lead.length))![0];
    reps.push({ start: run.start, end: run.end, text: lead + encodeText(t.text) + trail });
  }
  if (edit.href !== undefined) {
    const linkEl = [...ancestorsOf(doc, index), el].reverse().find((e) => e.name === "a");
    if (linkEl) reps.push(attrReplacement(linkEl, "href", edit.href));
  }
  if (el.name === "img") {
    if (edit.src !== undefined) reps.push(attrReplacement(el, "src", edit.src));
    if (edit.alt !== undefined) reps.push(attrReplacement(el, "alt", edit.alt));
  }
  return applyReplacements(html, reps);
}

export function applyReplacements(html: string, reps: Replacement[]): string {
  let out = html;
  // Back to front, so earlier positions stay valid.
  for (const r of [...reps].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  return out;
}

export const DESIGN_INDEX_ATTR = "data-plx-i";
const HEAD_ONLY = new Set(["head", "meta", "link", "title", "base", "style", "script", "html"]);

/**
 * The same page with each element in the body numbered (`data-plx-i`), for the Design view's preview. This copy is only
 * ever shown, never saved. The numbers match `parseSource(html).elements[n]`.
 */
export function annotateForDesign(html: string, doc: SrcDoc = parseSource(html)): string {
  const reps: Replacement[] = [];
  const inHead = (el: SrcElement) => {
    for (let p = el.index; p >= 0; p = doc.elements[p].parent) if (doc.elements[p].name === "head") return true;
    return false;
  };
  for (const el of doc.elements) {
    if (HEAD_ONLY.has(el.name) || inHead(el)) continue;
    const at = el.start + 1 + el.name.length;
    reps.push({ start: at, end: at, text: ` ${DESIGN_INDEX_ATTR}="${el.index}"` });
  }
  return applyReplacements(html, reps);
}

/** Puts a fragment (a script or style block) just before </body>, or at the very end when the page has none. */
export function insertBeforeBodyClose(html: string, fragment: string): string {
  const masked = html.replace(/<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi, (b) => " ".repeat(b.length));
  let at = -1;
  const re = /<\/body\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) at = m.index;
  return at === -1 ? html + fragment : html.slice(0, at) + fragment + html.slice(at);
}

/**
 * Runs inside the Design preview (never on a published page). Outlines what is under the pointer, tells the editor which
 * element was clicked, and stops links and forms from taking the preview away. The page's own scripts keep running.
 */
export function designBridgeScript(opts: { scrollY?: number; selected?: number } = {}): string {
  const y0 = Math.max(0, Math.round(Number(opts.scrollY) || 0));
  const sel0 = Number.isInteger(opts.selected) ? Number(opts.selected) : -1;
  return `<style data-plx-bridge>[${DESIGN_INDEX_ATTR}]{cursor:pointer}.plx-hover{outline:2px dashed #6366f1!important;outline-offset:2px}.plx-picked{outline:3px solid #6366f1!important;outline-offset:2px}</style><script data-plx-bridge>(function(){
var hov=null,sel=null,y0=${y0},sel0=${sel0};
function pick(t){while(t&&t.nodeType===1){if(t.hasAttribute&&t.hasAttribute('${DESIGN_INDEX_ATTR}'))return t;t=t.parentElement}return null}
function mark(el,cls){if(!el)return;el.classList.add(cls)}
function unmark(el,cls){if(el)el.classList.remove(cls)}
document.addEventListener('mouseover',function(e){var el=pick(e.target);if(el===hov)return;unmark(hov,'plx-hover');hov=el;if(el&&el!==sel)mark(el,'plx-hover')},true);
document.addEventListener('mouseout',function(e){if(!e.relatedTarget){unmark(hov,'plx-hover');hov=null}},true);
document.addEventListener('click',function(e){var el=pick(e.target);e.preventDefault();e.stopPropagation();
if(!el){parent.postMessage({plx:'pick',index:-1},'*');return}
unmark(hov,'plx-hover');unmark(sel,'plx-picked');sel=el;mark(el,'plx-picked');
parent.postMessage({plx:'pick',index:Number(el.getAttribute('${DESIGN_INDEX_ATTR}'))},'*')},true);
document.addEventListener('submit',function(e){e.preventDefault()},true);
function select(i){unmark(sel,'plx-picked');sel=i>=0?document.querySelector('[${DESIGN_INDEX_ATTR}="'+i+'"]'):null;if(sel)mark(sel,'plx-picked')}
window.addEventListener('load',function(){if(y0)window.scrollTo(0,y0);select(sel0);parent.postMessage({plx:'ready'},'*')});
var t=null;window.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){parent.postMessage({plx:'scroll',y:window.scrollY},'*')},120)},{passive:true});
window.addEventListener('message',function(e){var d=e.data;if(!d||d.plx!=='select')return;unmark(sel,'plx-picked');sel=d.index>=0?document.querySelector('[${DESIGN_INDEX_ATTR}="'+d.index+'"]'):null;if(sel){mark(sel,'plx-picked');sel.scrollIntoView({block:'nearest'})}});
})();</script>`;
}
