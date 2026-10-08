// A blog layout is a whole HTML document (a WordPress migration's is the site's own page:
// <html>, <head> with its styles, <body class="… elementor-kit-20">). The blog pages render
// inside the app's own <html>/<body>, so it used to be dropped into a <div> whole — and a
// browser ignores a second <body>'s classes when the page already has a body with a class.
// Every style hung off those classes (an Elementor kit's colours, fonts, heading sizes,
// buttons) silently stopped applying. Here the document is taken apart instead: its head and
// body content go in the page, and its <html>/<body> attributes are put on the real ones
// before anything is drawn.

type Attrs = Record<string, string>;

function parseAttrs(source: string): Attrs {
  const attrs: Attrs = {};
  for (const m of source.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

export interface LayoutParts {
  /** Head and body content, ready to go inside the page. */
  content: string;
  htmlAttrs: Attrs;
  bodyAttrs: Attrs;
}

/** Splits a full document into what goes in the page and what goes on <html>/<body>. A fragment passes through as is. */
export function splitLayoutDocument(html: string): LayoutParts {
  const bodyOpen = /<body\b([^>]*)>/i.exec(html);
  if (!bodyOpen) return { content: html, htmlAttrs: {}, bodyAttrs: {} };
  const htmlOpen = /<html\b([^>]*)>/i.exec(html);
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  const bodyStart = bodyOpen.index + bodyOpen[0].length;
  const bodyEnd = html.toLowerCase().lastIndexOf("</body>");
  const body = html.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : undefined);
  return { content: head + body, htmlAttrs: htmlOpen ? parseAttrs(htmlOpen[1]) : {}, bodyAttrs: parseAttrs(bodyOpen[1]) };
}

/** Puts the layout's <html>/<body> attributes on the page's own (classes are added, not replaced). */
function applyAttrsScript(htmlAttrs: Attrs, bodyAttrs: Attrs): string {
  const data = JSON.stringify({ h: htmlAttrs, b: bodyAttrs }).replace(/</g, "\\u003c");
  return `(function(d){function a(el,attrs){for(var k in attrs){if(k==="class"){attrs[k].split(/\\s+/).forEach(function(c){if(c)el.classList.add(c)})}else{el.setAttribute(k,attrs[k])}}}a(document.documentElement,d.h);a(document.body,d.b)})(${data});`;
}

/** Marks the page as showing a whole layout document (see LAYOUT_DOC_RESET). */
const LAYOUT_DOC_CLASS = "plexo-layout-doc";

/**
 * The app's own reset (Tailwind's preflight and the app's base styles, all in the `base`
 * cascade layer) also applies to these pages — and a site built for the browser's defaults
 * breaks under it: `border-width: 0` on everything took the outline off Muzingo's "Join a
 * game" button (its CSS sets only border-style), margins and heading sizes went too. Here
 * that layer is undone for a page showing a layout document, back to the browser's defaults
 * the site was built on. Custom properties (Tailwind's theme, the site's own) are untouched
 * — `all` never covers them — and the site's own CSS isn't in a layer, so it's unaffected.
 */
const LAYOUT_DOC_RESET = `@layer base{html.${LAYOUT_DOC_CLASS},html.${LAYOUT_DOC_CLASS} body,html.${LAYOUT_DOC_CLASS} *,html.${LAYOUT_DOC_CLASS} *::before,html.${LAYOUT_DOC_CLASS} *::after{all:revert-layer}}`;

export function LayoutDocument({ html }: { html: string }) {
  const { content, htmlAttrs, bodyAttrs } = splitLayoutDocument(html);
  const isDocument = /<body\b/i.test(html);
  const pageAttrs = isDocument ? { ...htmlAttrs, class: `${htmlAttrs.class ?? ""} ${LAYOUT_DOC_CLASS}`.trim() } : htmlAttrs;
  const hasAttrs = Object.keys(pageAttrs).length > 0 || Object.keys(bodyAttrs).length > 0;
  return (
    <>
      {isDocument && <style dangerouslySetInnerHTML={{ __html: LAYOUT_DOC_RESET }} />}
      {/* First in the page, so it runs before any of the layout is drawn. */}
      {hasAttrs && <script dangerouslySetInnerHTML={{ __html: applyAttrsScript(pageAttrs, bodyAttrs) }} />}
      {/* eslint-disable-next-line react/no-danger */}
      <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: content }} />
    </>
  );
}
