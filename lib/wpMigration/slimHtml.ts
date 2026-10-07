import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

// A migrated page's HTML lives in one database record, which DynamoDB caps at 400 KB.
// Cache/optimization plugins inline a lot into the page itself — WP Rocket's "used CSS"
// alone is 530 KB on maildrip.io/pricing — so a page WordPress serves happily can be too
// big to save. This moves the largest inline <style>/<script> blocks into files served
// from the site's own domain, loaded from exactly the same place in the page: the cascade
// and script order are unchanged, so the page renders and behaves the same.

/** Comfortably under the 400 KB record limit, leaving room for the record's other fields. */
export const MAX_STORED_HTML_BYTES = 300_000;
/** Past this the record can't be saved at all (400 KB, less the record's other fields). */
const HARD_LIMIT_BYTES = 380_000;
/** Blocks smaller than this stay inline — moving them wouldn't help and costs a request. */
const MIN_BLOCK_BYTES = 4_000;
/** Where the files are served: under the site's root page (see the pub route's asset walk). */
export const INLINE_FILES_DIR = "plexo-inline";

export type SaveInlineFile = (relPath: string, body: Buffer, contentType: string) => Promise<void>;

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/**
 * Relative url(...) in CSS resolves against the stylesheet's address, not the page's, so
 * moving CSS out of the page would break them — pin each to the root-relative path it
 * meant on the page.
 */
export function pinCssUrls(css: string, pagePath: string): string {
  const base = `https://plexo.invalid${pagePath.startsWith("/") ? pagePath : `/${pagePath}`}`;
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote: string, ref: string) => {
    const url = ref.trim();
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return match; // absolute, root-relative, data:, or a fragment
    try {
      const resolved = new URL(url, base);
      return `url(${quote}${resolved.pathname}${resolved.search}${resolved.hash}${quote})`;
    } catch {
      return match;
    }
  });
}

const RUNNABLE_SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

/**
 * Returns HTML small enough to store, moving the largest inline blocks into files (saved
 * via `save`) until it fits. HTML that already fits is returned untouched. `pagePath` is
 * the page's address on the site (what relative CSS urls were relative to).
 */
export async function slimForStorage(html: string, pagePath: string, save: SaveInlineFile, limit = MAX_STORED_HTML_BYTES): Promise<string> {
  if (bytes(html) <= limit) return html;
  const $ = cheerio.load(html);

  type Block = { el: cheerio.Cheerio<any>; kind: "style" | "script"; text: string; size: number };
  const blocks: Block[] = [];
  $("style").each((_, el) => {
    const node = $(el);
    if (node.parents("noscript, template, svg").length > 0) return;
    const text = node.html() ?? "";
    if (bytes(text) >= MIN_BLOCK_BYTES) blocks.push({ el: node, kind: "style", text, size: bytes(text) });
  });
  $("script:not([src])").each((_, el) => {
    const node = $(el);
    // Only plain runnable scripts: JSON data, templates and loader-managed types (e.g. WP
    // Rocket's delayed "rocketlazyloadscript") are read in place by other code.
    if (!RUNNABLE_SCRIPT_TYPES.has((node.attr("type") ?? "").trim().toLowerCase())) return;
    if (node.parents("template").length > 0) return;
    const text = node.html() ?? "";
    if (bytes(text) >= MIN_BLOCK_BYTES) blocks.push({ el: node, kind: "script", text, size: bytes(text) });
  });
  // Styles first (moving CSS is the safest change), biggest first.
  blocks.sort((a, b) => (a.kind === b.kind ? b.size - a.size : a.kind === "style" ? -1 : 1));

  let total = bytes(html);
  for (const block of blocks) {
    if (total <= limit) break;
    const body = block.kind === "style" ? pinCssUrls(block.text, pagePath) : block.text;
    const ext = block.kind === "style" ? "css" : "js";
    const relPath = `${INLINE_FILES_DIR}/${createHash("sha256").update(body).digest("hex").slice(0, 20)}.${ext}`;
    await save(relPath, Buffer.from(body, "utf8"), block.kind === "style" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
    const href = `/${relPath}`;
    const id = block.el.attr("id");
    if (block.kind === "style") {
      const media = block.el.attr("media");
      block.el.replaceWith(`<link rel="stylesheet" href="${href}"${id ? ` id="${id}"` : ""}${media ? ` media="${media}"` : ""}>`);
    } else {
      // async/defer did nothing on an inline script; on an external one they'd change when it runs.
      const attrs = Object.entries(block.el.attr() ?? {})
        .filter(([k]) => k !== "async" && k !== "defer")
        .map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${String(v).replace(/"/g, "&quot;")}"`))
        .join("");
      block.el.replaceWith(`<script src="${href}"${attrs}></script>`);
    }
    total -= block.size;
  }
  const out = $.html();
  if (bytes(out) > HARD_LIMIT_BYTES) {
    // Still over even the hard limit: the page is mostly markup. Say so plainly.
    throw new Error(`This page is too large to store (${Math.round(bytes(out) / 1024)} KB of content even after moving its styles and scripts into files).`);
  }
  return out;
}
