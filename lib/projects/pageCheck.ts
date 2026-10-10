import type { Page } from "playwright-core";

// Opening a page the way a visitor would and reporting what it shows: a screenshot plus every
// error the page hit while loading. Shared by Plexo's own browser (lambda/browser) and the
// Browserbase fallback (lib/projects/screenshot.ts), so both report exactly the same way.
// No AWS or network code here — it only drives a page it's given.

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
} as const;
export type Viewport = keyof typeof VIEWPORTS;

export type PageCheck = {
  image: Buffer;
  title: string;
  url: string;
  consoleErrors: string[];
  failedRequests: string[];
  status: number | null;
};

// A full-page shot of a very long page is cut at this height: past it the model can't read
// it anyway, and it keeps the image well under Lambda's 6 MB response limit.
const MAX_FULL_PAGE_HEIGHT = 8_000;

export async function checkPage(page: Page, url: string, opts: { viewport?: Viewport; fullPage?: boolean } = {}): Promise<PageCheck> {
  const viewport = VIEWPORTS[opts.viewport ?? "desktop"];
  await page.setViewportSize(viewport);
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && consoleErrors.length < 20) consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on("pageerror", (err) => {
    if (consoleErrors.length < 20) consoleErrors.push(`Uncaught: ${err.message}`.slice(0, 500));
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && failedRequests.length < 20) failedRequests.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  const response = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
  // Let the app fetch its data and render (an SPA keeps working after "load").
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  let image: Buffer;
  if (opts.fullPage) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => viewport.height);
    image = await page.screenshot({ type: "jpeg", quality: 70, fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height: Math.min(Math.max(height, viewport.height), MAX_FULL_PAGE_HEIGHT) } });
  } else {
    image = await page.screenshot({ type: "jpeg", quality: 70 });
  }
  return { image, title: await page.title(), url: page.url(), consoleErrors, failedRequests, status: response?.status() ?? null };
}
