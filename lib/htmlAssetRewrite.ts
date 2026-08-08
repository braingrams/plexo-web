import * as cheerio from "cheerio";
import postcss from "postcss";

import { isExternalRef, resolveRelativePath } from "@/app/dashboard/templates/[id]/preview-utils";

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
 * Deliberately only rewrites `link[href]`, `script[src]`, `img[src]`, and CSS `url()` inside
 * inline `<style>` blocks — NOT `<a href>` (already stripped entirely for this preview by
 * annotateTextNodesForPreview, so there's nothing left to rewrite there) and not attempting
 * full HTML-attribute-regex coverage the way the client-side "Preview" modal's
 * buildPreviewHtml does, since this only ever needs to fix the root document's OWN
 * references, not resolve an arbitrary file's refs relative to ITS OWN directory.
 *
 * This must only ever be applied to a disposable preview copy, never to what gets extracted
 * from or saved back to compiledHtml — the relative paths there are what actually get
 * persisted, and rewriting them to (deploy-specific, will eventually change) blob URLs would
 * corrupt that.
 */
export function rewriteAssetReferencesForPreview(html: string, assets: { path: string; blobUrl: string }[]): string {
  if (assets.length === 0) return html;
  const byPath = new Map(assets.map((a) => [a.path, a.blobUrl]));

  function resolve(ref: string | undefined): string | null {
    if (!ref || isExternalRef(ref)) return null;
    const resolved = resolveRelativePath("index.html", ref);
    return byPath.get(resolved) ?? null;
  }

  const $ = cheerio.load(html);

  $("link[href]").each((_, el) => {
    const mapped = resolve($(el).attr("href"));
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
    let parsed;
    try {
      parsed = postcss.parse(cssText);
    } catch {
      return;
    }
    let changed = false;
    parsed.walkDecls((decl) => {
      const match = /url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(decl.value);
      if (!match) return;
      const mapped = resolve(match[2]);
      if (mapped) {
        decl.value = decl.value.replace(match[0], `url("${mapped}")`);
        changed = true;
      }
    });
    if (changed) $(styleEl).text(parsed.toString());
  });

  return $.html();
}
