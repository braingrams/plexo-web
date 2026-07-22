import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "../../domains/route";

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
      // 1. Check database cache
      try {
        const cached = await prisma.stockCache.findUnique({
          where: {
            provider_query: {
              provider: p,
              query,
            },
          },
        });

        const isCacheValid = cached && (Date.now() - new Date(cached.createdAt).getTime() < 24 * 60 * 60 * 1000);
        if (isCacheValid) {
          return cached.results as unknown as StockImageResult[];
        }
      } catch (cacheErr) {
        console.warn(`Prisma cache read failed for provider ${p}:`, cacheErr);
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

      // 3. Cache the results if we found any actual data
      if (providerResults.length > 0) {
        try {
          await prisma.stockCache.upsert({
            where: {
              provider_query: {
                provider: p,
                query,
              },
            },
            create: {
              provider: p,
              query,
              results: providerResults as any,
            },
            update: {
              results: providerResults as any,
              createdAt: new Date(),
            },
          });
        } catch (cacheWriteErr) {
          console.warn(`Failed to write cache for provider ${p}:`, cacheWriteErr);
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
