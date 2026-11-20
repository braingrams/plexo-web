// Validates and re-writes the snippets an owner pastes into "Header code" / "Footer code".
//
// Safety model: the owner is trusted to choose WHAT runs on their own site (that is the point of a
// tracking or verification snippet), but not to be able to break the page or smuggle in anything
// that is not a snippet. So we never store or inject what they typed. We parse it with a small
// strict reader, accept only <script>, <meta>, <link>, <noscript> and <style> (plus the <img> and
// <iframe> tags those pixel snippets put inside <noscript>), reject anything we cannot read, and
// build the saved HTML again from the parsed pieces, with every attribute value re-escaped. The
// result can't contain stray text, unclosed tags, comments, or a tag that closes the snippet early.
// Pure: no I/O, so it is the same on the server route, the MCP tool and in tests.
//
// TRUST MODEL. A <script> the owner pastes runs with full power on THEIR OWN site (that is what a
// tracking pixel is), so we do not try to inspect JavaScript: the owner is trusted with what their
// own visitors run, exactly like WordPress "insert headers and footers". What we guarantee is the
// SHAPE: the saved result is only the allowed tags, each closed properly, with nothing that can end
// early and spill markup onto the page (the "</script/>" and "<!--" tricks), nothing that redirects or
// re-configures the page (<meta http-equiv=refresh>, set-cookie, a new content-security-policy, a
// different charset), no <base>, no <svg>/<object>/<embed>/<form>, no event-handler attributes on
// anything but <script>, no javascript:/data: addresses, no srcdoc, script/iframe sources only from
// https. Because the code is re-written from what we parsed, case tricks ("<ScRiPt>"), stray quotes
// and entity-encoded schemes ("java&#115;cript:") end up as harmless literal text. It is applied
// only on the owner's own custom domain (lib/customCode/gate.ts), never in the editor or dashboard.
// Every save is audited (who and when, lib/customCode/store.ts).

export const MAX_CUSTOM_CODE_CHARS = 20_000;
const MAX_TAGS = 25;
const MAX_NOSCRIPT_CHILDREN = 5;

export type CodeCheck = { ok: true; html: string } | { ok: false; error: string };

const TOP_LEVEL = new Set(["script", "meta", "link", "noscript", "style"]);
const NOSCRIPT_CHILDREN = new Set(["img", "iframe", "link", "meta", "style"]);
const VOID = new Set(["meta", "link", "img"]);
const ATTR_NAME = /^[a-zA-Z_][a-zA-Z0-9_:.-]*$/;
const URL_ATTRS = new Set(["src", "href", "action", "data", "poster", "formaction", "xlink:href"]);
const SECURE_URL = /^(https:)?\/\//i;
// <meta http-equiv=...> values that redirect the page, set cookies or change its security rules.
const BAD_HTTP_EQUIV = /^(refresh|set-cookie|content-security-policy(-report-only)?|content-type|content-language|x-frame-options|location)$/i;

const NICE = "Only <script>, <meta>, <link>, <noscript> and <style> snippets can be added.";

type Parsed = { tag: string; attrs: [string, string | null][]; body: string; children: Parsed[] };

class Reject extends Error {}

function escAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Decode the few entities a pasted attribute may contain so we escape once, not twice.
function unescAttr(v: string): string {
  return v.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function checkUrl(tag: string, name: string, value: string): void {
  // Strip whitespace/control characters browsers ignore inside a scheme ("java\nscript:").
  // eslint-disable-next-line no-control-regex
  const compact = value.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!compact) return;
  if (/^[a-z][a-z0-9+.-]*:/i.test(compact) && !/^https?:/i.test(compact)) {
    throw new Reject(`A ${name} address in a <${tag}> tag isn't allowed. Use a normal https:// address.`);
  }
  if ((tag === "script" || tag === "iframe") && name === "src" && !SECURE_URL.test(compact)) {
    throw new Reject(`The ${name} of a <${tag}> tag must be a full https:// address.`);
  }
}

function readTag(src: string, start: number, nested: boolean, state: { tags: number }): { node: Parsed; end: number } {
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(start, start + 40));
  if (!m) throw new Reject("Something here doesn't look like a snippet. Paste the code exactly as the service gave it to you.");
  const tag = m[1].toLowerCase();
  const allowed = nested ? NOSCRIPT_CHILDREN : TOP_LEVEL;
  if (!allowed.has(tag)) {
    throw new Reject(nested ? `<${tag}> isn't allowed inside <noscript>.` : `<${tag}> tags can't be added. ${NICE}`);
  }
  if (++state.tags > MAX_TAGS) throw new Reject(`That's a lot of tags. Keep it to ${MAX_TAGS} or fewer.`);

  let i = start + m[0].length;
  const attrs: [string, string | null][] = [];
  let selfClose = false;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) throw new Reject(`A <${tag}> tag isn't finished (it's missing its closing ">").`);
    if (src[i] === ">") {
      i++;
      break;
    }
    if (src[i] === "/" && src[i + 1] === ">") {
      selfClose = true;
      i += 2;
      break;
    }
    const nm = /^[^\s=>/"'<]+/.exec(src.slice(i));
    if (!nm) throw new Reject(`A <${tag}> tag has something we can't read. Paste the code exactly as given.`);
    const name = nm[0].toLowerCase();
    if (!ATTR_NAME.test(name)) throw new Reject(`A <${tag}> tag has an odd attribute name ("${name.slice(0, 30)}").`);
    i += nm[0].length;
    let j = i;
    while (j < src.length && /\s/.test(src[j])) j++;
    let value: string | null = null;
    if (src[j] === "=") {
      j++;
      while (j < src.length && /\s/.test(src[j])) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, j + 1);
        if (close === -1) throw new Reject(`A <${tag}> tag has a quote that never closes.`);
        value = src.slice(j + 1, close);
        i = close + 1;
      } else {
        const um = /^[^\s>"'=<`]+/.exec(src.slice(j));
        if (!um) throw new Reject(`A <${tag}> tag has an attribute with no value.`);
        value = um[0];
        i = j + um[0].length;
      }
    }
    if (name.startsWith("on") && tag !== "script") throw new Reject(`Event attributes like "${name}" aren't allowed on <${tag}> tags.`);
    if (name === "srcdoc") throw new Reject("The srcdoc attribute isn't allowed.");
    if (tag === "meta" && name === "charset") throw new Reject("A <meta charset> tag isn't needed and could garble your page. Remove it.");
    if (tag === "meta" && name === "http-equiv" && value !== null && BAD_HTTP_EQUIV.test(unescAttr(value).trim())) {
      throw new Reject("That <meta> tag would redirect visitors or change how the page is secured, so it can't be added. Verification tags use name=\"...\" instead.");
    }
    if (name === "http-equiv" && tag !== "meta") throw new Reject("The http-equiv attribute is only for <meta> tags.");
    if (name === "style" && value && /expression\s*\(|javascript:/i.test(value)) throw new Reject("That inline style isn't allowed.");
    if (value !== null) {
      const decoded = unescAttr(value);
      if (URL_ATTRS.has(name)) checkUrl(tag, name, decoded);
      attrs.push([name, decoded]);
    } else {
      attrs.push([name, null]);
    }
  }

  if (tag === "link" && !attrs.some(([n]) => n === "href")) throw new Reject("A <link> tag needs an href.");
  if (tag === "iframe" && !attrs.some(([n]) => n === "src")) throw new Reject("An <iframe> inside <noscript> needs a src.");

  if (VOID.has(tag)) return { node: { tag, attrs, body: "", children: [] }, end: i };
  if (selfClose) throw new Reject(`A <${tag}> tag must be closed with </${tag}>, not written as <${tag} />.`);

  if (tag === "script" || tag === "style" || tag === "iframe") {
    const closeRe = new RegExp(`</${tag}\\s*>`, "ig");
    closeRe.lastIndex = i;
    const cm = closeRe.exec(src);
    if (!cm) throw new Reject(`A <${tag}> tag isn't closed. Add </${tag}> at the end.`);
    const body = src.slice(i, cm.index);
    if (tag === "script" && body.includes("<!--")) throw new Reject('A script contains the characters "<!--", which can break the page. Remove them.');
    // Browsers also end a script at "</script/>" or "</script x>", which our own reader would not see.
    if (tag === "script" && /<\/script/i.test(body)) throw new Reject('A script contains the text "</script" inside it, which can break the page. Remove it or split it up.');
    if (tag === "style" && /<\/?style/i.test(body)) throw new Reject("That style block contains a stray <style> tag.");
    if (tag === "style" && /expression\s*\(|javascript:|behavior\s*:/i.test(body)) throw new Reject("That style block uses something that isn't allowed (an expression or javascript: address).");
    if (tag === "iframe" && body.trim()) throw new Reject("An <iframe> can't have content inside it.");
    return { node: { tag, attrs, body: tag === "iframe" ? "" : body, children: [] }, end: cm.index + cm[0].length };
  }

  // <noscript>: a few allowed children, no loose text.
  const children: Parsed[] = [];
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) throw new Reject("A <noscript> tag isn't closed. Add </noscript> at the end.");
    if (src.startsWith("</", i)) {
      const cm = /^<\/noscript\s*>/i.exec(src.slice(i));
      if (!cm) throw new Reject("Something inside <noscript> isn't closed properly.");
      i += cm[0].length;
      break;
    }
    if (src[i] !== "<") throw new Reject("Plain text can't go inside <noscript>.");
    if (children.length >= MAX_NOSCRIPT_CHILDREN) throw new Reject("There's too much inside <noscript>.");
    const r = readTag(src, i, true, state);
    children.push(r.node);
    i = r.end;
  }
  return { node: { tag, attrs, body: "", children }, end: i };
}

function emit(n: Parsed): string {
  const attrs = n.attrs.map(([k, v]) => (v === null ? ` ${k}` : ` ${k}="${escAttr(v)}"`)).join("");
  if (VOID.has(n.tag)) return `<${n.tag}${attrs}>`;
  if (n.tag === "noscript") return `<noscript${attrs}>${n.children.map(emit).join("")}</noscript>`;
  return `<${n.tag}${attrs}>${n.body}</${n.tag}>`;
}

export type Snippet = { index: number; ok: boolean; /** What this snippet is, in plain words ("Google site verification"). */ summary: string; error?: string };

const host = (u: string): string => {
  try {
    return new URL(u.startsWith("//") ? `https:${u}` : u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const attrOf = (n: Parsed, name: string) => n.attrs.find(([k]) => k === name)?.[1] ?? "";

/** A plain-language name for one parsed snippet, so the owner sees what they pasted was understood. */
function describeSnippet(n: Parsed): string {
  const text = n.tag === "noscript" ? n.children.map(emit).join(" ") : n.body;
  const src = attrOf(n, "src") || attrOf(n, "href");
  const h = host(src);
  const all = `${src} ${text}`.toLowerCase();
  if (n.tag === "meta") {
    const name = attrOf(n, "name").toLowerCase();
    if (name === "google-site-verification") return "Google Search Console site verification";
    if (name === "facebook-domain-verification") return "Facebook (Meta) domain verification";
    if (name === "msvalidate.01") return "Bing site verification";
    if (name === "p:domain_verify") return "Pinterest site verification";
    return name ? `A "${name.slice(0, 40)}" page tag` : "A page tag";
  }
  if (/fbq\(|fbevents\.js|facebook\.com\/tr/.test(all)) return "Meta (Facebook) pixel";
  if (/hotjar|hj\(/.test(all)) return "Hotjar";
  if (/googletagmanager\.com\/gtm|gtm\.start/.test(all)) return "Google Tag Manager";
  if (/googletagmanager\.com\/gtag|gtag\(|google-analytics\.com/.test(all)) return "Google Analytics";
  if (/clarity\.ms/.test(all)) return "Microsoft Clarity";
  if (/tiktok/.test(all)) return "TikTok pixel";
  if (n.tag === "script") return h ? `A script from ${h}` : "A script";
  if (n.tag === "style") return "Your own styles";
  if (n.tag === "link") return h ? `A link to ${h} (for example a font or stylesheet)` : "A page link tag";
  return "A snippet for visitors with scripts turned off";
}

type Analysis = { ok: true; html: string; snippets: Snippet[] } | { ok: false; error: string; snippets: Snippet[] };

/**
 * Reads the code one snippet at a time. On success: the re-written HTML plus a plain name for each snippet.
 * On the first snippet it can't accept: its position, the reason, and the snippets before it (which were fine).
 */
export function analyzeCustomCode(input: unknown): Analysis {
  if (input === null || input === undefined) return { ok: true, html: "", snippets: [] };
  if (typeof input !== "string") return { ok: false, error: "The code has to be text.", snippets: [] };
  if (input.length > MAX_CUSTOM_CODE_CHARS) {
    return { ok: false, error: `That's too long (${input.length.toLocaleString("en-US")} characters). The most you can add here is ${MAX_CUSTOM_CODE_CHARS.toLocaleString("en-US")}.`, snippets: [] };
  }
  if (input.includes("\u0000")) return { ok: false, error: "The code contains a character that can't be saved. Copy it again from the service.", snippets: [] };
  const src = input.trim();
  if (!src) return { ok: true, html: "", snippets: [] };
  if (/PASTE-YOUR-CODE-HERE/i.test(src)) {
    return { ok: false, error: "Replace PASTE-YOUR-CODE-HERE with the code the service gave you.", snippets: [{ index: 1, ok: false, summary: "Snippet 1", error: "Replace PASTE-YOUR-CODE-HERE with the code the service gave you." }] };
  }
  const state = { tags: 0 };
  const out: string[] = [];
  const snippets: Snippet[] = [];
  let i = 0;
  try {
    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) break;
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i + 4);
        if (end === -1) throw new Reject("A comment in the code never closes.");
        i = end + 3; // comments are dropped, never saved
        continue;
      }
      if (src[i] !== "<") throw new Reject(`There's text here that isn't part of a snippet. ${NICE}`);
      const r = readTag(src, i, false, state);
      out.push(emit(r.node));
      snippets.push({ index: snippets.length + 1, ok: true, summary: describeSnippet(r.node) });
      i = r.end;
    }
    return { ok: true, html: out.join("\n"), snippets };
  } catch (e) {
    const error = e instanceof Reject ? e.message : "We couldn't read that code. Paste it exactly as the service gave it to you.";
    const n = snippets.length + 1;
    return { ok: false, error, snippets: [...snippets, { index: n, ok: false, summary: `Snippet ${n}`, error }] };
  }
}

/** Empty input is fine (it clears the code). Anything else must be a clean run of allowed tags. */
export function sanitizeCustomCode(input: unknown): CodeCheck {
  const a = analyzeCustomCode(input);
  return a.ok ? { ok: true, html: a.html } : { ok: false, error: a.error };
}
