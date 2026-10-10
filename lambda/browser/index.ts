import chromium from "@sparticuz/chromium";
import { chromium as playwright, type Browser } from "playwright-core";
import { checkPage, type Viewport } from "@/lib/projects/pageCheck";

// Plexo's own browser: Chromium running inside this Lambda (no third-party browser service,
// no shared limit — each check is its own invocation). SOL and the MCP use it to look at an
// app's preview after building (lib/projects/screenshot.ts); Browserbase is only the backup.
// Returns the screenshot as base64; the caller stores it.

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  // Kept between checks while this instance is warm — launching Chromium is most of the cost.
  if (browser?.isConnected()) return browser;
  browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  return browser;
}

export type BrowserCheckRequest = { url: string; viewport?: Viewport; fullPage?: boolean };

export const handler = async (event: BrowserCheckRequest) => {
  if (typeof event?.url !== "string" || !event.url.startsWith("https://")) throw new Error("Only https:// pages can be checked.");
  const context = await (await getBrowser()).newContext();
  try {
    const result = await checkPage(await context.newPage(), event.url, { viewport: event.viewport, fullPage: event.fullPage });
    return { ...result, image: result.image.toString("base64") };
  } finally {
    await context.close().catch(() => {});
  }
};
