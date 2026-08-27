import type { ExternalStylesheet } from "@/lib/htmlColorExtraction";

/**
 * A multi-file RAW_UPLOAD template's CSS often lives entirely in linked stylesheets
 * (TemplateAsset, stored in Vercel Blob) rather than inline <style> blocks — anything that
 * needs a page's real CSS (color extraction, scroll-reveal detection) needs their actual
 * text, not just whatever compiledHtml's own inline <style> blocks carry. Fetched fresh
 * every call, same as app/api/v1/templates/[id]/files/route.ts's GET already does for the
 * file-listing endpoint — there's no content column to read from instead.
 */
export async function fetchCssStylesheetContents(
  assets: { path: string; blobUrl: string }[],
): Promise<ExternalStylesheet[]> {
  const cssAssets = assets.filter((a) => a.path.toLowerCase().endsWith(".css"));
  const fetched = await Promise.all(
    cssAssets.map(async (a) => {
      const res = await fetch(a.blobUrl).catch(() => null);
      const content = res && res.ok ? await res.text() : "";
      return { path: a.path, content };
    }),
  );
  return fetched.filter((s) => s.content.length > 0);
}
