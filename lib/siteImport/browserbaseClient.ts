import { chromium } from "playwright-core";

// Managed headless-browser provider for site-import's Wix/thin-shell rendering fallback —
// see headlessFetch.ts for why a managed provider was chosen over self-hosting Chromium on
// Vercel. Verified against Browserbase's own docs (docs.browserbase.com) once a real API key
// was available: earlier revisions of this file guessed at a one-call "render and return
// HTML" endpoint that doesn't actually exist — Browserbase's real model is create a session,
// get back a `connectUrl` (a CDP WebSocket URL), then drive the browser yourself via
// Playwright. `playwright-core` (not the full `playwright` package) is used deliberately: it
// has no bundled browser download, since we're only ever connecting to Browserbase's remote
// Chrome over CDP, never launching a local one.

export class BrowserbaseNotConfiguredError extends Error {
  constructor() {
    super("Headless rendering isn't configured (missing BROWSERBASE_API_KEY).");
    this.name = "BrowserbaseNotConfiguredError";
  }
}

const BROWSERBASE_API_BASE = "https://api.browserbase.com/v1";

function requireApiKey(): string {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new BrowserbaseNotConfiguredError();
  return apiKey;
}

interface CreateSessionResponse {
  id: string;
  connectUrl: string;
}

/**
 * Renders `url` in a managed headless browser and returns the fully-loaded page's HTML.
 * Creates a short-lived session per call rather than pooling — site-import's fetch volume
 * (bounded by maxPages, batched a handful at a time) doesn't warrant session reuse
 * complexity, and a fresh session avoids state (cookies/localStorage) leaking between
 * unrelated pages/sites. No projectId is sent when creating the session — Browserbase infers
 * it from the API key itself (confirmed against the current API reference: projectId is
 * optional on POST /v1/sessions).
 */
export async function renderViaBrowserbase(url: string, timeoutMs = 30_000): Promise<string> {
  const apiKey = requireApiKey();

  const createRes = await fetch(`${BROWSERBASE_API_BASE}/sessions`, {
    method: "POST",
    headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!createRes.ok) {
    throw new Error(`Browserbase session creation failed (${createRes.status}): ${await createRes.text().catch(() => "")}`);
  }
  const session = (await createRes.json()) as CreateSessionResponse;

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, { timeout: timeoutMs });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    // domcontentloaded, not networkidle: a real marketing site with persistent background
    // connections (analytics beacons, websockets, polling) may never truly go idle, timing
    // this out for no good reason — confirmed against a real page. A short settle delay
    // covers the client-side render that still needs to finish after DOM-ready.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(2000);
    return await page.content();
  } finally {
    await browser?.close().catch(() => {});
    // Best-effort session release — helps avoid unnecessary usage charges once we're done;
    // a leaked session times out on its own regardless, so a failure here isn't fatal.
    await fetch(`${BROWSERBASE_API_BASE}/sessions/${session.id}`, {
      method: "POST",
      headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REQUEST_RELEASE" }),
    }).catch(() => {});
  }
}
