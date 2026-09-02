import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { StockCache } from "@/lib/db/opsEntities";
import { resolveUser } from "@/lib/auth/resolveUser";

export interface StockImageResult {
  id: string;
  src: string;
  alt: string;
  provider: "unsplash" | "pexels" | "pixabay";
  credit: string;
  source: string;
  downloadLocation?: string;
  photographerUrl?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("query") || "modern workspace").trim().toLowerCase();
    const provider = (searchParams.get("provider") || "all").trim().toLowerCase();

    const targetProviders = provider === "all" ? ["unsplash", "pexels", "pixabay"] : [provider];

    // API keys MUST ONLY come from request headers — DO NOT FALL BACK to server environment variables
    const unsplashKey = (request.headers.get("x-unsplash-key") || "").trim();
    const pexelsKey = (request.headers.get("x-pexels-key") || "").trim();
    const pixabayKey = (request.headers.get("x-pixabay-key") || "").trim();

    // Query and fetch all providers concurrently using Promise.all
    const providerPromises = targetProviders.map(async (p): Promise<StockImageResult[]> => {
      // 1. Check cache (StockCache — lib/db/opsEntities.ts; provider+query is its whole
      // primary key, so this is a direct .get(), no index gap here).
      try {
        const { data: cached } = await StockCache.get({ provider: p, query }).go();
        const isCacheValid = !!cached?.createdAt && Date.now() - new Date(cached.createdAt).getTime() < 24 * 60 * 60 * 1000;
        if (isCacheValid && cached) {
          return cached.results as unknown as StockImageResult[];
        }
      } catch (cacheErr) {
        console.warn(`Cache read failed for provider ${p}:`, cacheErr);
      }

      // 2. Fetch fresh results from APIs
      let providerResults: StockImageResult[] = [];

      try {
        if (p === "unsplash" && unsplashKey) {
          const res = await fetch(
            `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=50`,
            { headers: { Authorization: `Client-ID ${unsplashKey}` } }
          );
          if (res.ok) {
            const data = await res.json();
            providerResults = ((data.results as Array<any>) || []).map((item) => ({
              id: `unsplash-${item.id}`,
              src: item.urls?.regular,
              alt: item.alt_description || item.description || query,
              provider: "unsplash" as const,
              credit: item.user?.name || "Unsplash Photographer",
              source: item.links?.html || "https://unsplash.com",
              downloadLocation: item.links?.download_location,
              photographerUrl: item.user?.links?.html,
            })).filter((i) => i.src);
          }
        } else if (p === "pexels" && pexelsKey) {
          const res = await fetch(
            `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=50`,
            { headers: { Authorization: pexelsKey } }
          );
          if (res.ok) {
            const data = await res.json();
            providerResults = ((data.photos as Array<any>) || []).map((item) => ({
              id: `pexels-${item.id}`,
              src: item.src?.large2x || item.src?.large || item.src?.medium,
              alt: item.alt || query,
              provider: "pexels" as const,
              credit: item.photographer || "Pexels Photographer",
              source: item.url || "https://pexels.com",
              photographerUrl: item.photographer_url,
            })).filter((i) => i.src);
          }
        } else if (p === "pixabay" && pixabayKey) {
          const res = await fetch(
            `https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(query)}&image_type=photo&per_page=50`
          );
          if (res.ok) {
            const data = await res.json();
            providerResults = ((data.hits as Array<any>) || []).map((item) => ({
              id: `pixabay-${item.id}`,
              src: item.largeImageURL || item.webformatURL,
              alt: item.tags || query,
              provider: "pixabay" as const,
              credit: item.user || "Pixabay Creator",
              source: item.pageURL || "https://pixabay.com",
            })).filter((i) => i.src);
          }
        }
      } catch (fetchErr) {
        console.warn(`Direct fetch failed for provider ${p}:`, fetchErr);
      }

      // 3. Cache the results if we found any actual data — create-or-refresh, since
      // StockCache has no updateMany/upsert helper in ElectroDB's write API, just create
      // (fails if the item already exists) and patch (fails if it doesn't). createdAt is
      // readOnly (opsEntities.ts), so a refresh can't `.set()` it directly — remove then
      // recreate instead, which resets both createdAt and the TTL clock for free.
      if (providerResults.length > 0) {
        try {
          await StockCache.create({ id: randomUUID(), provider: p, query, results: providerResults }).go();
        } catch {
          await StockCache.remove({ provider: p, query })
            .go()
            .then(() => StockCache.create({ id: randomUUID(), provider: p, query, results: providerResults }).go())
            .catch((cacheWriteErr) => console.warn(`Failed to refresh cache for provider ${p}:`, cacheWriteErr));
        }
      }

      return providerResults;
    });

    const resultsList = await Promise.all(providerPromises);
    const mergedResults = resultsList.flat();

    return NextResponse.json(mergedResults.slice(0, 150));
  } catch (error) {
    console.error("Stock search failed:", error);
    return NextResponse.json({ error: "Stock search failed" }, { status: 500 });
  }
}
