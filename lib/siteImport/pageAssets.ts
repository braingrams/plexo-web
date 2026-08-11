import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { extensionOf } from "@/server/rawUpload";
import { internalizeAsset, type InternalizedAsset } from "./assetInternalize";

export interface PageAssetResult {
  /** The page's HTML with every successfully-internalized same-origin asset URL rewritten to its new relative path. */
  html: string;
  created: { path: string; asset: InternalizedAsset }[];
  warnings: string[];
}

function isSameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/** Deterministic, collision-safe relative path for a source asset URL — a short hash of the URL itself (not its content) avoids needing the download to complete before naming it, and avoids collisions between differently-pathed same-named files (two themes' "style.css"). */
function relativePathFor(sourceUrl: string): string {
  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 12);
  const ext = extensionOf(sourceUrl) || "bin";
  return `assets/${hash}.${ext}`;
}

/**
 * Finds every same-origin asset reference in a crawled page (stylesheets, scripts, images —
 * the things a theme/site itself serves), downloads+internalizes each via assetInternalize.ts
 * (content-hash deduped per job), and rewrites the page's HTML to point at the new relative
 * paths (the same "relative path as referenced in the HTML" convention TemplateAsset already
 * uses — app/pub/[domain]/[[...slug]].route.ts's <base href> injection resolves these
 * correctly at serve time, unchanged). Cross-origin references (third-party scripts, fonts,
 * embeds, CDN-hosted libraries) are deliberately left untouched — carried into the imported
 * page exactly as they were, per the "only internalize what the site itself owns" design.
 * A per-asset failure (download error, disallowed extension, oversized) leaves that one
 * reference pointing at the original external URL rather than breaking the page — collected
 * in `warnings` for the job's error/warning log, never fatal to the page import as a whole.
 */
export async function internalizeSameOriginAssets(html: string, pageUrl: string, jobId: string): Promise<PageAssetResult> {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const created: { path: string; asset: InternalizedAsset }[] = [];
  const rewrites = new Map<string, string>(); // sourceUrl -> relativePath

  const candidates: { attr: "href" | "src"; el: ReturnType<typeof $> }[] = [];
  $('link[rel="stylesheet"][href]').each((_, el) => {
    candidates.push({ attr: "href", el: $(el) });
  });
  $("script[src]").each((_, el) => {
    candidates.push({ attr: "src", el: $(el) });
  });
  $("img[src]").each((_, el) => {
    candidates.push({ attr: "src", el: $(el) });
  });

  const uniqueSourceUrls = new Set<string>();
  for (const { attr, el } of candidates) {
    const raw = el.attr(attr);
    if (!raw) continue;
    let absolute: string;
    try {
      absolute = new URL(raw, pageUrl).toString();
    } catch {
      continue;
    }
    if (isSameOrigin(absolute, pageUrl)) uniqueSourceUrls.add(absolute);
  }

  await Promise.all(
    Array.from(uniqueSourceUrls).map(async (sourceUrl) => {
      const relativePath = relativePathFor(sourceUrl);
      const result = await internalizeAsset(jobId, relativePath, sourceUrl);
      if (result.ok) {
        rewrites.set(sourceUrl, relativePath);
        created.push({ path: relativePath, asset: result.asset });
      } else {
        warnings.push(result.reason);
      }
    }),
  );

  let rewrittenHtml = html;
  for (const [sourceUrl, relativePath] of rewrites) {
    rewrittenHtml = rewrittenHtml.split(sourceUrl).join(relativePath);
  }

  return { html: rewrittenHtml, created, warnings };
}
