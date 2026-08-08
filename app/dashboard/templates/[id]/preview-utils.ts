import type { FileEntry } from "@/app/api/v1/templates/[id]/files/route";

// Resolves a reference found inside `fromPath` against the site's flat relative-path
// namespace (e.g. dir "css", ref "../images/logo.png" -> "images/logo.png"), the same
// way a browser would resolve it when the file is actually served at its real path.
export function resolveRelativePath(fromPath: string, ref: string): string {
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const clean = ref.split(/[?#]/)[0];
  const parts = (dir ? dir.split("/") : []).concat(clean.split("/"));
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

export function isExternalRef(ref: string): boolean {
  return /^([a-z]+:)?\/\//i.test(ref) || ref.startsWith("data:") || ref.startsWith("#") || ref.startsWith("mailto:") || ref.startsWith("tel:");
}

function rewriteHtmlRefs(html: string, fromPath: string, pathToUrl: Map<string, string>): string {
  return html.replace(/\b(href|src)\s*=\s*(["'])(.*?)\2/gi, (match, attr, quote, ref) => {
    if (!ref || isExternalRef(ref)) return match;
    const resolved = resolveRelativePath(fromPath, ref);
    const mapped = pathToUrl.get(resolved);
    return mapped ? `${attr}=${quote}${mapped}${quote}` : match;
  });
}

function rewriteCssRefs(css: string, fromPath: string, pathToUrl: Map<string, string>): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, ref) => {
    if (!ref || isExternalRef(ref)) return match;
    const resolved = resolveRelativePath(fromPath, ref);
    const mapped = pathToUrl.get(resolved);
    return mapped ? `url(${quote}${mapped}${quote})` : match;
  });
}

/**
 * Builds an accurate live preview of a raw-upload site FROM CURRENT IN-MEMORY EDITS
 * (including unsaved changes) — entirely client-side, no server round trip, so it's
 * instant and reflects exactly what's in the editor right now.
 *
 * How: every binary asset (image/font) already has a real, publicly-fetchable blob URL
 * (see server/rawUpload.ts — raw-upload assets are `access: "public"`), so those are used
 * as-is. Every text file's *current edited content* is turned into a `blob:` object URL,
 * and every relative href/src/url() reference in the HTML and CSS is rewritten to point
 * at the matching blob/asset URL, resolved the same way a browser would resolve it at
 * the file's real served path. This covers the common cases (stylesheet links, script
 * tags, image/font references, and url()s nested inside CSS) but NOT relative ES module
 * `import` statements inside a script's own body — those resolve against the script's
 * blob: URL, which has no meaningful relative path, so cross-file module imports won't
 * work in preview even though they will once actually published under the real domain.
 *
 * @param rootPath - Which HTML page to render as the preview (a multi-page raw upload
 * can have more than one — e.g. "about.html" alongside "index.html"). Defaults to
 * "index.html"; callers should pass the currently-open file when it's itself HTML, so
 * "preview" reflects whichever page the user is actually looking at.
 */
export function buildPreviewHtml(
  files: FileEntry[],
  edits: Record<string, string>,
  rootPath: string = "index.html"
): { html: string; cleanup: () => void } {
  const createdUrls: string[] = [];
  const pathToUrl = new Map<string, string>();

  const otherEditable = files.filter((f) => f.editable && f.path !== rootPath);

  for (const f of files) {
    if (!f.editable && f.url) {
      pathToUrl.set(f.path, f.url);
      continue;
    }
    // An editable file with no unsaved edit gets its real, publicly-fetchable blob URL
    // instead of a freshly-minted blob: one — this modal's iframe deliberately runs with
    // `sandbox="allow-scripts"` and NO `allow-same-origin` (an opaque origin, so any script
    // the previewed page runs can't reach the dashboard's own session), and a blob: URL
    // created by this document isn't reliably fetchable from a child frame with a
    // different/opaque origin. The real https:// URL has no such restriction. Only an
    // ACTUAL unsaved edit still needs a blob: URL, since there's no other way to preview
    // content that was never saved.
    if (f.editable && f.path !== rootPath && f.url) {
      const current = edits[f.path] ?? f.content ?? "";
      if (current === (f.content ?? "")) pathToUrl.set(f.path, f.url);
    }
  }

  for (const f of otherEditable) {
    if (pathToUrl.has(f.path)) continue; // unedited — already mapped to its real URL above
    let content = edits[f.path] ?? f.content ?? "";
    if (f.path.toLowerCase().endsWith(".css")) {
      content = rewriteCssRefs(content, f.path, pathToUrl);
    }
    const blob = new Blob([content], { type: f.contentType || "text/plain" });
    const url = URL.createObjectURL(blob);
    createdUrls.push(url);
    pathToUrl.set(f.path, url);
  }

  const rootFile = files.find((f) => f.path === rootPath);
  const rootContent = rootFile ? (edits[rootPath] ?? rootFile.content ?? "") : "";
  const html = rewriteHtmlRefs(rootContent, rootPath, pathToUrl);

  return {
    html,
    cleanup: () => createdUrls.forEach((u) => URL.revokeObjectURL(u)),
  };
}
