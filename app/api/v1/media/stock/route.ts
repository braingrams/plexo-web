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

const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // matches the cache rows' own 7-day expiry (opsEntities.ts)
const FAILED_MS = 10 * 60 * 1000;
const FAILED_PREFIX = "__failed:";

async function saveCache(provider: string, query: string, results: unknown): Promise<void> {
  const row = { id: randomUUID(), provider, query, results: results as never };
  try {
    await StockCache.create(row).go();
  } catch {
    await StockCache.remove({ provider, query })
      .go()
      .then(() => StockCache.create({ ...row, id: randomUUID() }).go())
      .catch((err) => console.warn(`Failed to cache ${provider} "${query}":`, err));
  }
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

    // A key sent by the caller (the classic editor's own key) wins; otherwise Plexo's own accounts are used, so the photo
    // picker works for every signed-in owner without them bringing a key. The keys never leave the server in a response.
    const unsplashKey = (request.headers.get("x-unsplash-key") || process.env.UNSPLASH_KEY || "").trim();
    const pexelsKey = (request.headers.get("x-pexels-key") || process.env.PEXELS_KEY || "").trim();
    const pixabayKey = (request.headers.get("x-pixabay-key") || process.env.PIXABAY_KEY || "").trim();

    // Why a provider gave nothing (no key, or its service said no), so the picker can say so instead of "no photos found".
    const failures: Record<string, string> = {};
    const refused = (p: string, status: number, body: string) => {
      console.error(`[stock] ${p} search failed: HTTP ${status} ${body.slice(0, 200)}`);
      failures[p] = status === 429 || /rate limit/i.test(body) ? `${p[0].toUpperCase()}${p.slice(1)} has reached its hourly limit. Try Pexels or Pixabay, or try again later.` : `${p[0].toUpperCase()}${p.slice(1)} isn't responding right now. Try Pexels or Pixabay.`;
    };

    // Query and fetch all providers concurrently using Promise.all
    const providerPromises = targetProviders.map(async (p): Promise<StockImageResult[]> => {
      // 1. Check the cache first (StockCache — lib/db/opsEntities.ts; provider+query is its whole primary key). A search is
      // only sent to the photo service when nobody has made it in the last week, so the picker is fast and a provider's hourly
      // limit isn't spent on repeats. A service that just refused us is left alone for a few minutes (a "failed" marker) instead of
      // being asked again on every keystroke, and its older cached results are shown meanwhile.
      let stale: StockImageResult[] | null = null;
      try {
        const { data: cached } = await StockCache.get({ provider: p, query }).go();
        const results = (cached?.results ?? []) as unknown as StockImageResult[];
        if (cached && results.length > 0) {
          if (Date.now() - new Date(cached.createdAt ?? 0).getTime() < FRESH_MS) return results;
          stale = results;
        }
        const { data: failed } = await StockCache.get({ provider: p, query: `${FAILED_PREFIX}${query}` }).go();
        if (failed && Date.now() - new Date(failed.createdAt ?? 0).getTime() < FAILED_MS) {
          if (stale) return stale;
          failures[p] = String((failed.results as unknown as string[])[0] ?? `${p[0].toUpperCase()}${p.slice(1)} isn't responding right now. Try another source.`);
          return [];
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
          if (!res.ok) refused(p, res.status, await res.text().catch(() => ""));
          else {
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
          if (!res.ok) refused(p, res.status, await res.text().catch(() => ""));
          else {
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
          if (!res.ok) refused(p, res.status, await res.text().catch(() => ""));
          else {
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
        else failures[p] = `${p[0].toUpperCase()}${p.slice(1)} isn't set up on this Plexo. Try another source.`;
      } catch (fetchErr) {
        console.warn(`Direct fetch failed for provider ${p}:`, fetchErr);
        failures[p] = `${p[0].toUpperCase()}${p.slice(1)} isn't responding right now. Try another source.`;
      }

      // 3. Remember what we got (or that the service just said no). create-or-refresh: createdAt is readOnly (opsEntities.ts), so a
      // refresh removes then recreates, which resets the age and the 7-day expiry together.
      if (providerResults.length > 0) {
        // Plain JSON only: DynamoDB refuses `undefined` inside a stored map, which would silently skip the cache for that provider.
        await saveCache(p, query, JSON.parse(JSON.stringify(providerResults)));
      } else if (failures[p]) {
        if (stale) {
          delete failures[p];
          return stale;
        }
        await saveCache(p, `${FAILED_PREFIX}${query}`, [failures[p]]);
      }

      return providerResults;
    });

    const resultsList = await Promise.all(providerPromises);
    const mergedResults = resultsList.flat();
    // Everything asked for failed: say why (one provider chosen = that one's reason), rather than an empty list that reads as "no photos".
    if (mergedResults.length === 0 && Object.keys(failures).length === targetProviders.length) {
      return NextResponse.json({ error: Object.values(failures)[0] }, { status: 502 });
    }

    return NextResponse.json(mergedResults.slice(0, 150));
  } catch (error) {
    console.error("Stock search failed:", error);
    return NextResponse.json({ error: "Stock search failed" }, { status: 500 });
  }
}
