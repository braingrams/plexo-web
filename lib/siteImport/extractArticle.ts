import { Window } from "happy-dom";
import { Readability } from "@mozilla/readability";

export interface ExtractedArticle {
  title: string;
  html: string;
  excerpt?: string;
}

/**
 * Best-effort article-body extraction for platforms with no structured content API (Wix,
 * Webflow, and the generic/UNKNOWN fallback) — pulls the main content out of a full rendered
 * page using Mozilla's Readability algorithm (the same "reader mode" heuristic every major
 * browser ships), rather than hand-rolled largest-text-block heuristics. Paired with
 * happy-dom (already a dependency, already used server-side by htmlToTiptap.ts's
 * generateJSON call) instead of adding a second DOM library just for this.
 *
 * Callers should treat a successful result as lower-fidelity than a platform API/export
 * (WordPress REST, Squarespace ?format=json) — see SiteImportPage.heuristicExtraction, surfaced
 * in the final import report as "heuristically extracted, please review."
 */
export function extractArticle(html: string, url: string): ExtractedArticle | null {
  try {
    const window = new Window({ url });
    window.document.write(html);
    // Readability expects a lib.dom Document; happy-dom's is structurally compatible at
    // runtime (verified against real article markup) but not nominally typed as one.
    const reader = new Readability(window.document as unknown as Document);
    const article = reader.parse();
    if (!article?.content) return null;
    return { title: article.title || "Untitled", html: article.content, excerpt: article.excerpt || undefined };
  } catch {
    return null;
  }
}
