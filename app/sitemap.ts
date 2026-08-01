import type { MetadataRoute } from "next";
import { prisma } from "@/server/prisma";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL
  : "https://plexo.charisol.io";

const STATIC_ROUTES: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/developers", changeFrequency: "monthly", priority: 0.8 },
  { path: "/sdk", changeFrequency: "monthly", priority: 0.7 },
  { path: "/mcp", changeFrequency: "monthly", priority: 0.7 },
  { path: "/marketplace", changeFrequency: "daily", priority: 0.8 },
  { path: "/legal/acceptable-use", changeFrequency: "yearly", priority: 0.2 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const templates = await prisma.template.findMany({
    where: { marketplaceStatus: "PUBLISHED" },
    select: { id: true, marketplacePublishedAt: true, updatedAt: true },
    orderBy: { marketplacePublishedAt: "desc" },
    take: 5000,
  });

  const templateEntries: MetadataRoute.Sitemap = templates.map((t) => ({
    url: `${SITE_URL}/marketplace/${t.id}`,
    lastModified: t.updatedAt ?? t.marketplacePublishedAt ?? undefined,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticEntries, ...templateEntries];
}
