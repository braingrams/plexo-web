import * as cheerio from "cheerio";
import { SiteImportPlatform } from "@prisma/client";
import { safeFetch } from "./fetchSafe";
import { renderViaBrowserbase } from "./browserbaseClient";

export interface RenderedFetchResult {
  html: string;
  usedHeadless: boolean;
  finalUrl: string;
}

export interface RenderOptions {
  platformHint: SiteImportPlatform;
  forceHeadless?: boolean;
  timeoutMs?: number;
}

const THIN_SHELL_TEXT_THRESHOLD = 200;

/** True if a fetched page looks like a client-rendered app shell rather than real content. */
export function looksLikeThinShell(html: string): boolean {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const visibleText = $("body").text().replace(/\s+/g, " ").trim();
  if (visibleText.length < THIN_SHELL_TEXT_THRESHOLD) return true;
  const rootContainers = $("#root, #app, [data-reactroot]");
  if (rootContainers.length > 0 && rootContainers.text().trim().length < THIN_SHELL_TEXT_THRESHOLD) return true;
  return false;
}

/**
 * Fetches a page's rendered HTML, escalating to a managed headless browser (Browserbase) only
 * when needed: always for Wix (reliably client-rendered, see adapters/wix.ts), and for any
 * other platform whose static fetch comes back looking like a thin JS-app shell. Keeps cost/
 * latency down (a static fetch is orders of magnitude cheaper) without sacrificing correctness
 * on the platforms that actually need it.
 *
 * No silent fallback: if headless rendering is required but Browserbase isn't configured, this
 * throws (BrowserbaseNotConfiguredError, from browserbaseClient.ts) rather than returning the
 * empty-shell static result as if it were the real page — a visibly paused job is a far better
 * failure mode than silently importing blank pages.
 */
export async function fetchRenderedHtml(url: string, opts: RenderOptions): Promise<RenderedFetchResult> {
  const mustUseHeadless = opts.forceHeadless || opts.platformHint === SiteImportPlatform.WIX;

  if (!mustUseHeadless) {
    const res = await safeFetch(url);
    if (res.ok) {
      const html = await res.text();
      if (!looksLikeThinShell(html)) {
        return { html, usedHeadless: false, finalUrl: res.url || url };
      }
    }
  }

  const html = await renderViaBrowserbase(url, opts.timeoutMs ?? 30_000);
  return { html, usedHeadless: true, finalUrl: url };
}
