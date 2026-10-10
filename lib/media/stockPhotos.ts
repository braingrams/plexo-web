import { randomUUID } from "node:crypto";
import { StockCache } from "@/lib/db/opsEntities";

// Real photos for what SOL builds — on topic for the business, not random placeholders —
// from Plexo's own Unsplash / Pexels / Pixabay accounts (UNSPLASH_KEY, PEXELS_KEY,
// PIXABAY_KEY). Results are cached per provider + query for a day (StockCache, shared with
// the dashboard's image picker) so a build doesn't spend the providers' hourly quotas.

export type StockPhoto = { url: string; alt: string; credit: string; provider: "unsplash" | "pexels" | "pixabay"; sourceUrl: string; width?: number; height?: number };

const DAY_MS = 24 * 60 * 60 * 1000;

async function fromProvider(provider: StockPhoto["provider"], query: string): Promise<StockPhoto[]> {
  try {
    if (provider === "unsplash" && process.env.UNSPLASH_KEY) {
      const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=30&content_filter=high`, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_KEY}` } });
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: any[] };
      return (data.results ?? []).filter((p) => p.urls?.regular).map((p) => ({ url: p.urls.regular, alt: p.alt_description || p.description || query, credit: `${p.user?.name ?? "Unsplash photographer"} on Unsplash`, provider, sourceUrl: p.links?.html ?? "https://unsplash.com", width: p.width, height: p.height }));
    }
    if (provider === "pexels" && process.env.PEXELS_KEY) {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=30`, { headers: { Authorization: process.env.PEXELS_KEY } });
      if (!res.ok) return [];
      const data = (await res.json()) as { photos?: any[] };
      return (data.photos ?? []).filter((p) => p.src?.large2x || p.src?.large).map((p) => ({ url: p.src.large2x ?? p.src.large, alt: p.alt || query, credit: `${p.photographer ?? "Pexels photographer"} on Pexels`, provider, sourceUrl: p.url ?? "https://pexels.com", width: p.width, height: p.height }));
    }
    if (provider === "pixabay" && process.env.PIXABAY_KEY) {
      const res = await fetch(`https://pixabay.com/api/?key=${process.env.PIXABAY_KEY}&q=${encodeURIComponent(query)}&image_type=photo&safesearch=true&per_page=30`);
      if (!res.ok) return [];
      const data = (await res.json()) as { hits?: any[] };
      return (data.hits ?? []).filter((p) => p.largeImageURL).map((p) => ({ url: p.largeImageURL, alt: p.tags || query, credit: `${p.user ?? "Pixabay creator"} on Pixabay`, provider, sourceUrl: p.pageURL ?? "https://pixabay.com", width: p.imageWidth, height: p.imageHeight }));
    }
  } catch (err) {
    console.warn(`[stock] ${provider} search failed:`, err instanceof Error ? err.message : err);
  }
  return [];
}

async function cached(provider: StockPhoto["provider"], query: string): Promise<StockPhoto[]> {
  const key = `sol:${query}`;
  const { data } = await StockCache.get({ provider, query: key }).go().catch(() => ({ data: null }));
  if (data?.createdAt && Date.now() - new Date(data.createdAt).getTime() < DAY_MS) return data.results as unknown as StockPhoto[];
  const fresh = await fromProvider(provider, query);
  if (fresh.length) {
    await StockCache.remove({ provider, query: key }).go().catch(() => undefined);
    await StockCache.create({ id: randomUUID(), provider, query: key, results: fresh as never }).go().catch(() => undefined);
  }
  return fresh;
}

/** Photos for a search, best source first (Unsplash, then Pexels, then Pixabay), optionally
 *  only landscape or portrait ones. Empty when no provider is configured or nothing matched. */
export async function findStockPhotos(rawQuery: string, opts: { count?: number; orientation?: "landscape" | "portrait" | "any" } = {}): Promise<StockPhoto[]> {
  const query = rawQuery.trim().toLowerCase().slice(0, 100);
  if (!query) return [];
  const count = Math.min(Math.max(opts.count ?? 6, 1), 12);
  const fits = (p: StockPhoto) => !p.width || !p.height || opts.orientation === undefined || opts.orientation === "any" || (opts.orientation === "landscape" ? p.width >= p.height : p.height > p.width);
  const out: StockPhoto[] = [];
  for (const provider of ["unsplash", "pexels", "pixabay"] as const) {
    for (const p of await cached(provider, query)) if (fits(p) && out.length < count) out.push(p);
    if (out.length >= count) break;
  }
  return out;
}
