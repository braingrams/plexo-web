export interface ParsedUserAgent {
  deviceType: "mobile" | "tablet" | "desktop";
  browser: string;
  os: string;
}

/**
 * Lightweight, dependency-free User-Agent parser. Order matters — several browsers'
 * UA strings contain other browsers' tokens (Edge/Opera/Chrome-on-iOS all include
 * "Safari", Chrome/Opera both include "Chrome"), so more specific tokens are checked first.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const s = ua || "";

  let deviceType: ParsedUserAgent["deviceType"] = "desktop";
  if (/iPad/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) {
    deviceType = "tablet";
  } else if (/Mobi|iPhone|iPod|Android/i.test(s)) {
    deviceType = "mobile";
  }

  let browser = "Other";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\//i.test(s) || /Opera/i.test(s)) browser = "Opera";
  else if (/SamsungBrowser/i.test(s)) browser = "Samsung Internet";
  else if (/FxiOS/i.test(s) || /Firefox\//i.test(s)) browser = "Firefox";
  else if (/CriOS/i.test(s) || /Chrome\//i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s)) browser = "Safari";

  let os = "Other";
  if (/Windows/i.test(s)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Mac OS X/i.test(s)) os = "macOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Linux/i.test(s)) os = "Linux";

  return { deviceType, browser, os };
}

export interface GeoInfo {
  country: string | null;
  region: string | null;
  city: string | null;
}

/**
 * Where a visitor is, from the headers the edge network adds — free, no GeoIP service or raw-IP lookup:
 *  - CloudFront (how Plexo is served on AWS): CloudFront-Viewer-Country / -Country-Region / -City. CloudFront only
 *    hands these to the app when the distribution's cache policy names them (cdk/lib/published-sites-stack.ts,
 *    pageCachePolicy) — without that every visit shows "Unknown".
 *  - Vercel (the previous host): x-vercel-ip-*, kept so a Vercel deploy or preview still works.
 * Both are simply absent in local dev, which is fine — the fields stay null.
 */
export function extractGeoFromHeaders(headers: Headers): GeoInfo {
  const country = headers.get("cloudfront-viewer-country") ?? headers.get("x-vercel-ip-country");
  const region = headers.get("cloudfront-viewer-country-region") ?? headers.get("x-vercel-ip-country-region");
  const rawCity = headers.get("cloudfront-viewer-city") ?? headers.get("x-vercel-ip-city");
  let city = rawCity;
  if (rawCity) {
    // Vercel percent-encodes the city; CloudFront sends it as is ("São Paulo", or a name with a stray "%").
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }
  return { country: country || null, region: region || null, city: city || null };
}
