import type { MetadataRoute } from "next";
import type { EntityItem } from "electrodb";
import { Template } from "@/lib/db/contentEntities";
import { RELEASES } from "@/app/releases/data";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL
  : "https://plexo.charisol.io";

const STATIC_ROUTES: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/developers", changeFrequency: "monthly", priority: 0.8 },
  { path: "/sdk", changeFrequency: "monthly", priority: 0.7 },
  { path: "/mcp", changeFrequency: "monthly", priority: 0.7 },
  { path: "/marketplace", changeFrequency: "daily", priority: 0.8 },
  { path: "/releases", changeFrequency: "weekly", priority: 0.6 },
  { path: "/legal/acceptable-use", changeFrequency: "yearly", priority: 0.2 },
];

/**
 * Bounded scan over every PUBLISHED template — same documented pattern as
 * lib/marketplace.ts's own scanPublishedTemplates (not reused directly since it isn't
 * exported, and sitemap generation is its own low-frequency, non-request-critical job):
 * Template spent both of its GSI slots on the two hot authenticated-dashboard access
 * patterns (org list, page tree), so marketplace-wide browsing by marketplaceStatus has no
 * dedicated index (see contentEntities.ts's own comment on the Template entity). Cursor-
 * driven `.scan`, capped at 5000 to match the original's `take`.
 */
async function scanPublishedTemplatesForSitemap(limit: number): Promise<EntityItem<typeof Template>[]> {
  const all: EntityItem<typeof Template>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: EntityItem<typeof Template>[]; cursor: string | null } = await Template.scan
      .where(({ marketplaceStatus }, { eq }) => eq(marketplaceStatus, "PUBLISHED"))
      .go({ cursor });
    all.push(...page.data);
    cursor = page.cursor;
    if (!cursor || all.length >= limit) break;
  }
  return all.slice(0, limit);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const templates = await scanPublishedTemplatesForSitemap(5000);
  templates.sort((a, b) => (b.marketplacePublishedAt ?? "").localeCompare(a.marketplacePublishedAt ?? ""));

  const templateEntries: MetadataRoute.Sitemap = templates.map((t) => ({
    url: `${SITE_URL}/marketplace/${t.id}`,
    lastModified: (t.updatedAt ?? t.marketplacePublishedAt) ? new Date(t.updatedAt ?? t.marketplacePublishedAt!) : undefined,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const releaseEntries: MetadataRoute.Sitemap = RELEASES.map((r) => ({
    url: `${SITE_URL}/releases/${r.slug}`,
    lastModified: r.date,
    changeFrequency: "yearly",
    priority: 0.4,
  }));

  return [...staticEntries, ...releaseEntries, ...templateEntries];
}
