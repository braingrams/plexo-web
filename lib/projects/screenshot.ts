import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { BrowserbaseNotConfiguredError } from "@/lib/siteImport/browserbaseClient";
import { checkPage, VIEWPORTS, type PageCheck, type Viewport } from "./pageCheck";

// Opens an app's preview in a real browser, the way a visitor would, and reports what it
// shows: a screenshot plus every error the page hit while loading. SOL uses this to check its
// own work after building, instead of assuming a successful build means a working app.
//
// Plexo's own browser (lambda/browser — Chromium in a Lambda, SCREENSHOT_FUNCTION_NAME) is
// tried first: no outside service, no shared limit. Browserbase is the backup, used only if
// that fails.

export { VIEWPORTS, type Viewport };

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

let lambdaClient: LambdaClient | null = null;

/** Plexo's own browser, or null when this environment doesn't have one. */
async function viaOwnBrowser(url: string, opts: { viewport?: Viewport; fullPage?: boolean }): Promise<PageCheck | null> {
  const functionName = process.env.SCREENSHOT_FUNCTION_NAME;
  if (!functionName) return null;
  lambdaClient ??= new LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  const res = await lambdaClient.send(new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify({ url, viewport: opts.viewport, fullPage: opts.fullPage })) }));
  const body = res.Payload ? JSON.parse(Buffer.from(res.Payload).toString("utf8")) : null;
  if (res.FunctionError || !body?.image) throw new Error(body?.errorMessage ?? `browser function failed (${res.FunctionError ?? "no image"})`);
  return { ...body, image: Buffer.from(body.image, "base64") } as PageCheck;
}

async function viaBrowserbase(url: string, opts: { viewport?: Viewport; fullPage?: boolean }): Promise<PageCheck> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new BrowserbaseNotConfiguredError();
  const session = await openSession(apiKey);
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return await checkPage(page, url, opts);
  } finally {
    await browser?.close().catch(() => {});
    await fetch(`${API}/sessions/${session.id}`, { method: "POST", headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ status: "REQUEST_RELEASE" }) }).catch(() => {});
  }
}

export async function screenshotPage(url: string, opts: { viewport?: Viewport; userId: string; fullPage?: boolean }): Promise<ScreenshotResult> {
  let shot: PageCheck | null = null;
  try {
    shot = await viaOwnBrowser(url, opts);
  } catch (err) {
    console.warn("[screenshot] Plexo's browser failed, using Browserbase instead:", err instanceof Error ? err.message : err);
  }
  shot ??= await viaBrowserbase(url, opts);
  // Same private area as chat attachments (so SOL's attachment resolver can show it to the
  // model), tagged to expire after a week (data-stack.ts lifecycle rule).
  const bucket = process.env.USER_CONTENT_BUCKET_NAME!;
  const region = process.env.AWS_REGION || "us-east-1";
  const key = `private/sol-attachments/${opts.userId}/screenshots/${randomUUID()}.jpg`;
  await new S3Client({ region }).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: shot.image, ContentType: "image/jpeg", Tagging: "plexo-expire=screenshot" }));
  const imageUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  return { imageUrl, title: shot.title, url: shot.url, consoleErrors: shot.consoleErrors, failedRequests: shot.failedRequests, status: shot.status };
}
