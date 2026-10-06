import { safeFetch, type SafeFetchOptions } from "@/lib/siteImport/fetchSafe";

// Some managed WordPress hosts (and security plugins like Wordfence) serve a challenge
// page or 403 to requests with no browser-like User-Agent. Identifying ourselves honestly
// while still looking like a browser gets the same HTML a real visitor gets.
const USER_AGENT = "Mozilla/5.0 (compatible; PlexoMigrator/1.0; +https://plexopages.com)";

const MAX_RETRIES = 2;

/** safeFetch (SSRF-guarded) plus a browser-like UA and a short retry on 429/5xx — every migration fetch goes through here. */
export async function migrationFetch(url: string, init: SafeFetchOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", USER_AGENT);
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await safeFetch(url, { ...init, headers });
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number.parseInt(res.headers.get("retry-after") || "", 10);
        await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) ? Math.min(retryAfter, 10) * 1000 : 1500 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.name === "SsrfBlockedError") throw err;
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Couldn't fetch ${url}`);
}

/**
 * Builds a REST API URL that works for both permalink styles: "pretty" roots
 * (https://x.org/sub/wp-json/) take the route as a path, while "plain" permalink installs
 * only expose https://x.org/?rest_route=/ and need the route in the query string.
 */
export function restUrl(restRoot: string, route: string, params: Record<string, string | number> = {}): string {
  const cleanRoute = route.replace(/^\/+/, "");
  let url: URL;
  if (restRoot.includes("rest_route=")) {
    url = new URL(restRoot);
    url.searchParams.set("rest_route", `/${cleanRoute}`);
  } else {
    url = new URL(cleanRoute, restRoot.endsWith("/") ? restRoot : `${restRoot}/`);
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

export async function fetchJson<T>(url: string): Promise<{ data: T; headers: Headers } | null> {
  const res = await migrationFetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") || "";
  // A catch-all rewrite (or a splash page in front of WordPress) answers every path with
  // 200 text/html — that's "no API here", not a parse error worth surfacing.
  if (!contentType.includes("json")) return null;
  try {
    return { data: (await res.json()) as T, headers: res.headers };
  } catch {
    return null;
  }
}
