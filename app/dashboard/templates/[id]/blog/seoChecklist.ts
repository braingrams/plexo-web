export type ChecklistLevel = "good" | "warn";

export interface ChecklistItem {
  label: string;
  level: ChecklistLevel;
}

function wordCount(html: string): number {
  return html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * A Yoast/RankMath-lite on-page SEO checklist, computed client-side with no server round
 * trip and no plugin/license — heuristic, not a score, same spirit as those tools' green/
 * yellow indicators.
 */
export function computeSeoChecklist(input: {
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  featuredImageUrl: string;
  featuredImageAlt: string;
  contentHtml: string;
}): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  const effectiveTitle = input.metaTitle || input.title;
  items.push(
    effectiveTitle.length >= 30 && effectiveTitle.length <= 60
      ? { label: "Title length looks good for search results", level: "good" }
      : { label: `Title is ${effectiveTitle.length} characters — aim for 30–60`, level: "warn" },
  );

  const effectiveDescription = input.metaDescription || input.excerpt;
  items.push(
    effectiveDescription.length >= 50 && effectiveDescription.length <= 160
      ? { label: "Meta description length looks good", level: "good" }
      : effectiveDescription
        ? { label: `Meta description is ${effectiveDescription.length} characters — aim for 50–160`, level: "warn" }
        : { label: "No meta description set (an excerpt or one is needed for a good search snippet)", level: "warn" },
  );

  items.push(
    input.featuredImageUrl
      ? input.featuredImageAlt
        ? { label: "Featured image has alt text", level: "good" }
        : { label: "Featured image is missing alt text", level: "warn" }
      : { label: "No featured image set", level: "warn" },
  );

  const words = wordCount(input.contentHtml);
  items.push(
    words >= 300
      ? { label: `Content length is solid (${words} words)`, level: "good" }
      : { label: `Content is short (${words} words) — aim for 300+ for better ranking potential`, level: "warn" },
  );

  items.push(
    /<h[23][ >]/i.test(input.contentHtml)
      ? { label: "Uses subheadings — good for readability and SEO", level: "good" }
      : { label: "No subheadings yet — breaking up text with headings helps both readers and search engines", level: "warn" },
  );

  items.push(
    /<a[ >]/i.test(input.contentHtml)
      ? { label: "Contains at least one link", level: "good" }
      : { label: "No links yet — linking to related posts or sources helps SEO", level: "warn" },
  );

  return items;
}
