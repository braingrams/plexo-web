// The extras every Plexo site gets, for pages Plexo doesn't build itself: apps the owner deployed (static or server) and the
// blog. Their pages are produced elsewhere and relayed, so on the way out a finished page gets, in this order:
//   1. the "Fix it for me" speed and search options from Site health,
//   2. the owner's header and footer code (same rules as every other page: plan, own domain, not inside another page, payment
//      pages only if allowed, checked again here),
//   3. Google Analytics, last, so the same tag is never added twice.
// It only touches full HTML pages: JSON, fragments, redirects, errors and files pass through exactly as they were.

import { NextResponse } from "next/server";
import { applyOwnerCode, isEmbeddedRequest } from "./serve";
import { applyHealthSettings, healthSettingsFor, serveCtxFor } from "@/lib/siteHealth/serve";
import { applyAnalyticsTag } from "@/lib/googleAnalytics/serveTag";

/** Pages bigger than this are relayed untouched. */
export const MAX_APP_HTML_BYTES = 2 * 1024 * 1024;
const FULL_DOCUMENT = /<!doctype\s+html|<html[\s>]|<head[\s>]/i;

export function isFullHtmlDocument(html: string): boolean {
  return FULL_DOCUMENT.test(html);
}

export type OwnerCodeSite = { templateId: string; type: string; plan: string | null | undefined; secFetchDest?: string | null };
export type AppPageSite = OwnerCodeSite & { host: string; path: string; siteName: string; headers: Pick<Headers, "get"> };

/** One step of the chain: whatever goes wrong, the page carries on as it was. */
async function step(html: string, label: string, run: (h: string) => string | Promise<string>): Promise<string> {
  try {
    return await run(html);
  } catch (err) {
    console.warn(`[app-page] ${label} skipped`, err);
    return html;
  }
}

/** A finished HTML page with the site's speed options, the owner's code and Google Analytics added, or the same response when none applies. Never throws, never loses a response. */
export async function withAppPageExtras(response: NextResponse, site: AppPageSite): Promise<NextResponse> {
  try {
    if (response.status < 200 || response.status >= 300 || response.status === 204 || !response.body) return response;
    if (!/^\s*text\/html\b/i.test(response.headers.get("content-type") ?? "")) return response;
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_APP_HTML_BYTES) return response;

    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_APP_HTML_BYTES) return response;
    const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!isFullHtmlDocument(html)) return response;

    const canonicalUrl = `https://${site.host}${site.path}`;
    let out = await step(html, "speed options", async (h) => {
      const view = await healthSettingsFor(site.templateId);
      return applyHealthSettings(h, view, await serveCtxFor(h, view, { canonicalUrl, siteName: site.siteName }));
    });
    out = await step(out, "owner code", (h) => applyOwnerCode(h, site));
    out = await step(out, "google analytics", (h) => applyAnalyticsTag(h, site.templateId, site.headers));
    if (out === html) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new NextResponse(out, { status: response.status, headers });
  } catch (err) {
    console.warn(`[app-page] ${site.templateId}: serving the page without the extras`, err);
    return response;
  }
}
