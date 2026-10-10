import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { BrowserbaseNotConfiguredError } from "@/lib/siteImport/browserbaseClient";

// Opens an app's preview in a real browser (Browserbase), the way a visitor would, and
// reports what it shows: a screenshot plus every error the page hit while loading. SOL uses
// this to check its own work after building, instead of assuming a successful build means
// a working app.

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
} as const;
export type Viewport = keyof typeof VIEWPORTS;

const API = "https://api.browserbase.com/v1";

export type ScreenshotResult = {
  /** Private storage address of the JPEG (SOL attachments area, resolved for the model). */
  imageUrl: string;
  title: string;
  url: string;
  consoleErrors: string[];
  failedRequests: string[];
  status: number | null;
};

/** Thrown when the browser service stays busy — the app itself is fine. */
export const BROWSER_BUSY_MESSAGE =
  "The browser Plexo uses to look at the app is busy right now, so there's no screenshot this time. This isn't a problem with the app — the build itself is what matters. Don't try again this turn; carry on, and tell the owner they can check the preview themselves.";

// Browserbase answers 429 when the account's browsers are all in use (another check, an
// import, or the last one still closing). Waiting a little usually frees one; give up after
// ~25s rather than make the owner wait on a nice-to-have.
const BUSY_WAITS_MS = [2_000, 5_000, 8_000, 10_000];

async function openSession(apiKey: string, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ id: string; connectUrl: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/sessions`, { method: "POST", headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" }, body: "{}" });
    if (res.ok) return (await res.json()) as { id: string; connectUrl: string };
    if (res.status !== 429) throw new Error(`Couldn't open a browser to check the app (${res.status}).`);
    if (attempt >= BUSY_WAITS_MS.length) throw new Error(BROWSER_BUSY_MESSAGE);
    const retryAfter = Number(res.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15_000) : BUSY_WAITS_MS[attempt]);
  }
}
export const _openSessionForTests = openSession;

export async function screenshotPage(url: string, opts: { viewport?: Viewport; userId: string; fullPage?: boolean }): Promise<ScreenshotResult> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new BrowserbaseNotConfiguredError();
  const session = await openSession(apiKey);
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize(VIEWPORTS[opts.viewport ?? "desktop"]);
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
    const image = await page.screenshot({ type: "jpeg", quality: 70, fullPage: opts.fullPage ?? false });
    // Same private area as chat attachments (so SOL's attachment resolver can show it to the
    // model), tagged to expire after a week (data-stack.ts lifecycle rule).
    const bucket = process.env.USER_CONTENT_BUCKET_NAME!;
    const region = process.env.AWS_REGION || "us-east-1";
    const key = `private/sol-attachments/${opts.userId}/screenshots/${randomUUID()}.jpg`;
    await new S3Client({ region }).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: image, ContentType: "image/jpeg", Tagging: "plexo-expire=screenshot" }));
    const imageUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    return { imageUrl, title: await page.title(), url: page.url(), consoleErrors, failedRequests, status: response?.status() ?? null };
  } finally {
    await browser?.close().catch(() => {});
    await fetch(`${API}/sessions/${session.id}`, { method: "POST", headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ status: "REQUEST_RELEASE" }) }).catch(() => {});
  }
}
