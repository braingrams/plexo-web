import { chromium as playwright, type Browser } from "playwright-core";
import { checkPage, type Viewport } from "@/lib/projects/pageCheck";

// Plexo's own browser: Chromium running inside this Lambda (no third-party browser service,
// no shared limit — each check is its own invocation). SOL and the MCP use it to look at an
// app's preview after building (lib/projects/screenshot.ts); Browserbase is only the backup.
// Returns the screenshot as base64; the caller stores it.

// A fresh Chromium for every check, closed at the end. Lambda's Chromium runs as a single
// process and doesn't survive the instance being paused between calls — reusing it crashed
// the next check (seen on staging) — and launching costs only a second or two.
async function launchBrowser(): Promise<Browser> {
  // @sparticuz/chromium is ESM-only and this bundle is CommonJS, so it's loaded with import()
  // (kept as-is by the bundler) — a static import becomes require(), which Node refuses.
  const { default: chromium } = await import("@sparticuz/chromium");
  return playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

export type BrowserCheckRequest = { url: string; viewport?: Viewport; fullPage?: boolean };

export const handler = async (event: BrowserCheckRequest) => {
  if (typeof event?.url !== "string" || !event.url.startsWith("https://")) throw new Error("Only https:// pages can be checked.");
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext()).newPage();
    const result = await checkPage(page, event.url, { viewport: event.viewport, fullPage: event.fullPage });
    return { ...result, image: result.image.toString("base64") };
  } finally {
    await browser.close().catch(() => {});
  }
};
