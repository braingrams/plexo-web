import { forceRevealAnimationsForPreview } from "@/lib/htmlRevealPreview";
import { stripNoscriptForPreview } from "@/lib/htmlNoscriptStrip";
import { fetchCssStylesheetContents } from "@/lib/fetchCssAssets";

/**
 * Builds the HTML for a read-only, script-free preview (the Detail page's live preview
 * iframe) — the same "this preview never runs page JS" constraint the Text Content
 * editor's own preview pipeline already has to work around (text-content/route.ts),
 * reused here rather than duplicated:
 * - <script> tags stripped outright (the iframe's own `sandbox=""` already blocks
 *   execution regardless, but this also stops the browser fetching a remote script's src
 *   it's never going to run).
 * - <noscript> fallback content stripped (htmlNoscriptStrip.ts) — a real visitor with JS
 *   enabled never sees it; left in, a script-free preview shows it as if it were normal.
 * - The common scroll-triggered "reveal" pattern (a base class at opacity:0, a JS-added
 *   modifier class at opacity:1) statically forced visible (htmlRevealPreview.ts), since
 *   the observer that would ever add that class never runs here.
 */
export async function buildLivePreviewHtml(
  compiledHtml: string,
  assets: { path: string; blobUrl: string }[],
): Promise<string> {
  const externalStylesheets = assets.length > 0 ? await fetchCssStylesheetContents(assets) : [];
  const withoutScripts = compiledHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  return stripNoscriptForPreview(forceRevealAnimationsForPreview(withoutScripts, externalStylesheets));
}
