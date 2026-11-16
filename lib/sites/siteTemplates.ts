import { detectIndustry, detectStyle, listPageRecipes, type SiteIndustry, type SitePageType, type SiteStyle } from "@charisol/plexo-sdk/v2/compile";

import { listPublishedSiteTemplates } from "@/lib/marketplace";
import { TemplatePurchase } from "@/lib/db/contentEntities";

/**
 * list_site_templates: the ready-made starting points SOL can choose from for a brief — the
 * built-in page layouts (what site_create picks between) and the premium/marketplace site
 * designs — each tagged with the industry and style it suits, best fits first.
 */

export type SiteTemplateFilters = { industry?: string; style?: string; query?: string; pageType?: string; limit?: number };

export type TaggedSiteTemplate = {
  templateId: string;
  name: string;
  description: string | null;
  category: string | null;
  industry: SiteIndustry;
  style: SiteStyle;
  free: boolean;
  owned: boolean;
  price: string | null;
  editableInVisualEditor: boolean;
  previewUrl: string;
};

const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

/** Industry/style tags for a marketplace template, read from its category, name and description. Pure. */
export function tagTemplate(t: { name: string; category: string | null; description: string | null }): { industry: SiteIndustry; style: SiteStyle } {
  const text = `${t.name} ${t.description ?? ""}`;
  const industry = detectIndustry({ industry: t.category ?? undefined, about: text });
  return { industry, style: detectStyle({ tone: text, industry }) };
}

/** Best fits first: the same industry counts most, then the same style, then words from the request. Pure. */
export function scoreTemplate(tags: { industry: SiteIndustry; style: SiteStyle }, text: string, want: { industry?: SiteIndustry; style?: SiteStyle; words: string[] }): number {
  let s = 0;
  if (want.industry && want.industry !== "general") s += tags.industry === want.industry ? 4 : tags.industry === "general" ? 1 : 0;
  if (want.style) s += tags.style === want.style ? 3 : 0;
  const lower = text.toLowerCase();
  for (const w of want.words) if (w.length > 2 && lower.includes(w)) s += 1;
  return s;
}

export async function listSiteTemplates(userId: string, filters: SiteTemplateFilters) {
  const industry = filters.industry ? detectIndustry({ industry: filters.industry }) : undefined;
  const style = filters.style ? detectStyle({ tone: filters.style, industry: filters.industry }) : undefined;
  const words = (filters.query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const limit = Math.min(Math.max(Number(filters.limit) || 8, 1), 20);

  const published = await listPublishedSiteTemplates().catch(() => []);
  const paid = published.filter((t) => t.priceCents > 0);
  const owned = new Set(
    (await Promise.all(paid.map(async (t) => ((await TemplatePurchase.get({ userId, templateId: t.id }).go()).data ? t.id : null)))).filter((id): id is string => !!id),
  );
  const premium = published
    .map((t) => {
      const tags = tagTemplate(t);
      const free = t.priceCents === 0;
      const item: TaggedSiteTemplate = {
        templateId: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        ...tags,
        free,
        owned: free || owned.has(t.id),
        price: free ? null : `$${(t.priceCents / 100).toFixed(2)}`,
        editableInVisualEditor: t.designFormat === "v2",
        previewUrl: `${baseUrl()}/marketplace/${t.id}`,
      };
      return { item, score: scoreTemplate(tags, `${t.name} ${t.category ?? ""} ${t.description ?? ""}`, { industry, style, words }) };
    })
    .sort((a, b) => b.score - a.score || Number(b.item.owned) - Number(a.item.owned))
    .slice(0, limit)
    .map((x) => x.item);

  const pageType = filters.pageType ? (filters.pageType as SitePageType) : undefined;
  const layouts = listPageRecipes(pageType)
    .map((r) => ({
      layout: { layout: r.id, pageType: r.pageType, name: r.name, description: r.description, styles: r.styles, industries: r.industries },
      score: (industry && r.industries.includes(industry) ? 4 : r.industries.includes("general") ? 1 : 0) + (style && r.styles.includes(style) ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, pageType ? 10 : 30)
    .map((x) => x.layout);

  return {
    readAs: { industry: industry ?? null, style: style ?? null },
    premiumTemplates: premium,
    pageLayouts: layouts,
    next:
      "premiumTemplates are complete designs: create_site_from_template copies one into the owner's account (free or already-bought ones only — a paid one must be bought on its preview page first). pageLayouts are the built-in layouts: pass a layout id as a page's \"layout\" in site_create, or as templateId in page_create_from_template.",
  };
}
