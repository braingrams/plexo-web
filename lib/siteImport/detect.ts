import * as cheerio from "cheerio";
import { SiteImportPlatform } from "@prisma/client";
import { safeFetch } from "./fetchSafe";
import { normalizeSiteUrl } from "@/lib/blogImport/wpClient";

export interface PlatformDetectionResult {
  platform: SiteImportPlatform;
  reachable: boolean;
  finalUrl: string | null;
  homepageHtml: string | null;
}

/**
 * Runs on a single homepage fetch — no extra request beyond what the wizard's preview step
 * already needs. Signals are checked in priority order; the first strong match wins. Response
 * headers (x-generator, server) are deliberately NOT used as sole evidence — they're themeable/
 * proxyable on every one of these platforms, so at most a tiebreaker, never load-bearing.
 */
export function detectPlatformFromHtml(html: string): SiteImportPlatform {
  const $ = cheerio.load(html);
  const generator = ($('meta[name="generator"]').attr("content") || "").toLowerCase();

  // WordPress: its own REST-discovery <link> is emitted by core itself, independent of theme —
  // more reliable than the generator meta, which many themes strip or override.
  const hasWpApiLink = $('link[rel="https://api.w.org/"]').length > 0;
  if (hasWpApiLink || generator.includes("wordpress")) return SiteImportPlatform.WORDPRESS;

  if (generator.includes("squarespace")) return SiteImportPlatform.SQUARESPACE;
  if (generator.includes("wix.com")) return SiteImportPlatform.WIX;

  const assetHosts = Array.from($("[src],[href]"))
    .map((el) => $(el).attr("src") || $(el).attr("href") || "")
    .join(" ");

  if (/squarespace-cdn\.com|static1\.squarespace\.com/i.test(assetHosts)) return SiteImportPlatform.SQUARESPACE;
  if (/static\.wixstatic\.com/i.test(assetHosts)) return SiteImportPlatform.WIX;
  if (/assets-global\.website-files\.com|uploads-ssl\.webflow\.com/i.test(assetHosts)) return SiteImportPlatform.WEBFLOW;

  const hasWebflowAttrs = $("html[data-wf-site], html[data-wf-page], body[data-wf-page]").length > 0;
  if (hasWebflowAttrs) return SiteImportPlatform.WEBFLOW;

  return SiteImportPlatform.UNKNOWN;
}

export async function detectPlatform(rawUrl: string): Promise<PlatformDetectionResult> {
  const baseUrl = normalizeSiteUrl(rawUrl);
  try {
    const res = await safeFetch(baseUrl, { headers: { Accept: "text/html" } });
    if (!res.ok) return { platform: SiteImportPlatform.UNKNOWN, reachable: false, finalUrl: null, homepageHtml: null };
    const html = await res.text();
    return { platform: detectPlatformFromHtml(html), reachable: true, finalUrl: res.url || baseUrl, homepageHtml: html };
  } catch {
    return { platform: SiteImportPlatform.UNKNOWN, reachable: false, finalUrl: null, homepageHtml: null };
  }
}
