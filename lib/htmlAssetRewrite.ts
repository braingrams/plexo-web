import * as cheerio from "cheerio";
import postcss from "postcss";

import { isExternalRef, resolveRelativePath } from "@/app/dashboard/templates/[id]/preview-utils";
import type { ExternalStylesheet } from "@/lib/htmlColorExtraction";

/**
 * Rewrites every `url()` in a CSS text's declarations to the matching asset's blob URL,
 * resolving each relative reference against `fromPath` (the stylesheet's OWN path, not
 * index.html — a `url(../images/x.png)` inside `css/styles.css` means something different
 * than the same string would inside index.html). Uses a global replace per declaration
 * rather than matching only the first `url()`, since a `src:` declaration inside
 * `@font-face` commonly lists several `url()` fallbacks in one value.
 */
function rewriteCssUrls(cssText: string, fromPath: string, byPath: Map<string, string>): string {
  let parsed;
  try {
    parsed = postcss.parse(cssText);
  } catch {
    return cssText;
  }
  let changed = false;
  parsed.walkDecls((decl) => {
    const next = decl.value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote, ref: string) => {
      if (isExternalRef(ref)) return whole;
      const mapped = byPath.get(resolveRelativePath(fromPath, ref));
      return mapped ? `url("${mapped}")` : whole;
    });
    if (next !== decl.value) {
      decl.value = next;
      changed = true;
    }
  });
  return changed ? parsed.toString() : cssText;
}

/**
 * The Text Content tab's preview is rendered via `srcDoc` in a sandboxed iframe, which has
 * no real URL of its own — a multi-file RAW_UPLOAD template's `<link rel="stylesheet"
 * href="css/styles.css">` (or any other relative href/src/url() reference) has nothing to
 * resolve against there, so the browser's fetch for it silently fails and the whole page
 * renders unstyled. Rewriting every such reference to the asset's real, publicly-fetchable
 * blob URL fixes that — sandboxing blocks script EXECUTION and top-level navigation, not
 * passive resource loading, so a sandboxed iframe loads an external stylesheet/image/script
 * exactly as any other page would once its URL actually resolves to something.
 *
 * Linked stylesheets get a further rewrite, not just their own `<link href>`: fetched into
 * `externalStylesheets` (same content the color-extraction pass already needs — see
 * text-content/route.ts) and inlined as a `<style>` block with their own `url()`
 * references rewritten first. Simply pointing `<link href>` at the stylesheet's blob URL
 * isn't enough on its own — any relative asset the STYLESHEET ITSELF references (a
 * background-image, an @font-face src) would then resolve against that blob URL's own
 * location, which has no fixed relationship to the site's real file layout (Vercel Blob
 * appends a random suffix per object), so it 404s. This is what was silently breaking
 * decorative background-image graphics defined in linked CSS.
 *
 * Deliberately only rewrites `link[href]`, `script[src]`, `img[src]`, `url()` inside inline
 * `<style>` blocks/linked stylesheets, and `url()` inside inline `style=""` attributes —
 * not `<a href>` (already stripped entirely for this preview by annotateTextNodesForPreview)
 * and not attempting full HTML-attribute-regex coverage the way the client-side "Preview"
 * modal's buildPreviewHtml does, since this only ever needs to fix the root document's OWN
 * references, not resolve an arbitrary file's refs relative to ITS OWN directory.
 *
 * This must only ever be applied to a disposable preview copy, never to what gets extracted
 * from or saved back to compiledHtml — the relative paths there are what actually get
 * persisted, and rewriting them to (deploy-specific, will eventually change) blob URLs would
 * corrupt that.
 */
export function rewriteAssetReferencesForPreview(
  html: string,
  assets: { path: string; blobUrl: string }[],
  externalStylesheets: ExternalStylesheet[] = [],
): string {
  if (assets.length === 0) return html;
  const byPath = new Map(assets.map((a) => [a.path, a.blobUrl]));
  const cssByPath = new Map(externalStylesheets.map((s) => [s.path, s.content]));

  function resolve(ref: string | undefined): string | null {
    if (!ref || isExternalRef(ref)) return null;
    const resolved = resolveRelativePath("index.html", ref);
    return byPath.get(resolved) ?? null;
  }

  const $ = cheerio.load(html);

  $("link[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || isExternalRef(href)) return;
    const resolvedPath = resolveRelativePath("index.html", href);
    const cssContent = cssByPath.get(resolvedPath);
    if (cssContent !== undefined) {
      $(el).replaceWith(`<style>${rewriteCssUrls(cssContent, resolvedPath, byPath)}</style>`);
      return;
    }
    const mapped = byPath.get(resolvedPath);
    if (mapped) $(el).attr("href", mapped);
  });
  $("script[src]").each((_, el) => {
    const mapped = resolve($(el).attr("src"));
    if (mapped) $(el).attr("src", mapped);
  });
  $("img[src]").each((_, el) => {
    const mapped = resolve($(el).attr("src"));
    if (mapped) $(el).attr("src", mapped);
  });

  $("style").each((_, styleEl) => {
    const cssText = $(styleEl).html() ?? "";
    const rewritten = rewriteCssUrls(cssText, "index.html", byPath);
    if (rewritten !== cssText) $(styleEl).text(rewritten);
  });

  $("[style]").each((_, el) => {
    const styleAttr = $(el).attr("style");
    if (!styleAttr || !/url\(/i.test(styleAttr)) return;
    const rewritten = styleAttr.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote, ref: string) => {
      const mapped = resolve(ref);
      return mapped ? `url("${mapped}")` : whole;
    });
    if (rewritten !== styleAttr) $(el).attr("style", rewritten);
  });

  return $.html();
}
