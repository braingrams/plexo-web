/**
 * Screenshot harness. Captures every shot in shots.ts from the dev-only /v3-preview/** routes (made-up
 * data, no AWS, no sign-in) into docs/screenshots/<area>/<name>-<viewport>[-dark].png.
 *
 *   npx tsx scripts/screenshots/run.ts                 # starts `next dev` on :3111 (or reuses one), all shots
 *   npx tsx scripts/screenshots/run.ts blog home       # only these areas
 *   SHOT_ONLY=switch-warning npx tsx scripts/screenshots/run.ts editor   # one shot by name
 *   SHOT_BASE=http://localhost:3000 npx tsx ...        # use an already running dev server
 *   PLEXO_CHROMIUM=/path/to/chrome npx tsx ...         # pick a browser (default: Playwright's own)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { SHOTS, type Shot } from "./shots";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3111";
const ADMIN_BASE = process.env.SHOT_ADMIN_BASE ?? "http://localhost:3112";
const OUT = path.join(process.cwd(), "docs", "screenshots");
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 }, wide1280: { width: 1280, height: 900 } } as const;

/** Playwright's own revision may not be installed; fall back to any Chrome for Testing in its cache. */
function findBrowser(): string | undefined {
  if (process.env.PLEXO_CHROMIUM) return process.env.PLEXO_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((x) => x.startsWith("chromium-")).sort().reverse()) {
    const exe = path.join(root, d, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

async function up(): Promise<boolean> {
  try { return (await fetch(`${BASE}/v3-preview`, { signal: AbortSignal.timeout(60000) })).ok; } catch { return false; }
}

async function main() {
  const areas = process.argv.slice(2);
  let server: ChildProcess | null = null;
  if (!(await up())) {
    server = spawn("npx", ["next", "dev", "-p", new URL(BASE).port || "3111"], { stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } });
    for (let i = 0; i < 90 && !(await up()); i++) await new Promise((r) => setTimeout(r, 2000));
  }
  const browser = await chromium.launch({ executablePath: findBrowser() });
  let n = 0;
  for (const shot of SHOTS.filter((s) => (!areas.length || areas.includes(s.area)) && (!process.env.SHOT_ONLY || s.name === process.env.SHOT_ONLY))) {
    for (const vp of shot.viewports ?? ["desktop"]) {
      for (const theme of shot.themes ?? ["light"]) {
        const ctx = await browser.newContext({ viewport: SIZES[vp], deviceScaleFactor: 1, reducedMotion: "reduce" });
        await ctx.addCookies([{ name: "plexo-theme", value: theme, url: BASE }]);
        const page = await ctx.newPage();
        try {
          await capture(page, shot, vp, theme);
          n++;
        } catch (e) {
          console.error(`FAILED ${shot.area}/${shot.name} ${vp} ${theme}:`, (e as Error).message.split("\n")[0]);
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
  server?.kill();
  console.log(`${n} screenshots written to ${OUT}`);
}

/** Page thumbnails and previews are iframes onto the real preview API; answer them with a made-up page. */
function fakePage(page: string | null): string {
  const tones: Record<string, [string, string]> = { p2: ["#f3e9dc", "Our story"], p3: ["#e4eef7", "Say hello"], p4: ["#fbe9e2", "The shop"] };
  const [bg, title] = tones[page ?? ""] ?? ["#e8f1e4", "Spices that taste like home"];
  return `<!doctype html><meta charset=utf-8><body style="margin:0;font-family:Georgia,serif;background:${bg};color:#1d2a22"><div style="display:flex;justify-content:space-between;padding:28px 48px;font:600 22px Inter,sans-serif"><span style="color:#1f6f4a">Ama's Kitchen</span><span style="font-weight:400;font-size:18px">About &nbsp; Classes &nbsp; Contact</span></div><div style="padding:80px 48px;text-align:center"><h1 style="font-size:64px;margin:0 0 16px">${title}</h1><p style="font:22px Inter,sans-serif;margin:0 0 32px;color:#445">Hand-blended in Accra, shipped across Ghana and Nigeria.</p><span style="background:#1f6f4a;color:#fff;padding:18px 36px;border-radius:99px;font:600 20px Inter,sans-serif">Shop the spice mixes</span></div></body>`;
}

async function capture(page: Page, shot: Shot, vp: keyof typeof SIZES, theme: string) {
  await shot.setup?.(page);
  // Header and footer previews on Site layout: a made-up header bar or footer, in the same shape the real routes draw.
  const bar = (inner: string, bg: string, color: string) => `<!doctype html><meta charset=utf-8><body style="margin:0;font:600 22px Inter,sans-serif;background:${bg};color:${color}">${inner}`;
  const headerHtml = (variant: string) => bar(variant === "centered" ? `<div style="text-align:center;padding:34px 48px"><div style="font:700 30px Georgia,serif">Ama's Kitchen</div><div style="margin-top:14px;display:flex;gap:36px;justify-content:center;font-size:19px"><span>Home</span><span>Shop</span><span>About</span><span>Contact</span></div></div>` : `<div style="display:flex;justify-content:space-between;align-items:center;padding:34px 56px"><span style="font:700 30px Georgia,serif">Ama's Kitchen</span><span style="display:flex;gap:36px;font-size:19px"><span>Home</span><span>Shop</span><span>About</span><span>Contact</span></span></div>`, "#fff", "#1d2a22");
  const footerHtml = bar(`<div style="padding:56px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:48px;font-size:18px;font-weight:500"><div><div style="font:700 28px Georgia,serif">Ama's Kitchen</div><p style="font-weight:400;opacity:.8">Hand-blended spices, shipped across Ghana and Nigeria.</p></div><div><b>Pages</b><p>Home</p><p>Shop</p><p>About</p></div><div><b>Contact</b><p>hello@amaskitchen.com</p></div></div><div style="padding:0 56px 28px;font-size:15px;opacity:.7">© Ama's Kitchen</div>`, "#1d2a22", "#fff");
  await page.route(/\/api\/site-layout\/[^/]+\/looks\/preview/, (route) => { const u = new URL(route.request().url()).searchParams; return route.fulfill({ contentType: "text/html", body: u.get("kind") === "footer" ? footerHtml : headerHtml(u.get("variant") ?? "classic") }); });
  await page.route(/\/api\/v1\/templates\/(h1|f1)\/draft-preview/, (route) => route.fulfill({ contentType: "text/html", body: /\/f1\//.test(route.request().url()) ? footerHtml : headerHtml("classic") }));
  await page.route(/\/api\/v1\/templates\/[^/]+\/draft-preview/, (route) => route.fulfill({ contentType: "text/html", body: fakePage(new URL(route.request().url()).searchParams.get("page")) }));
  await page.goto((shot.admin ? ADMIN_BASE : BASE) + shot.path, { waitUntil: "load", timeout: 180000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
  await page.addStyleTag({ content: "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}" });
  await page.waitForTimeout(shot.wait ?? 600);
  const broken = await page.evaluate(() => !!document.querySelector("nextjs-portal")?.shadowRoot?.querySelector("[data-nextjs-dialog], [role=dialog]"));
  if (broken) throw new Error("the page shows a Next.js error overlay");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  if (shot.act) { await shot.act(page); await page.waitForTimeout(400); }
  const dir = path.join(OUT, shot.area);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${shot.name}-${vp === "desktop" ? "desktop" : vp}${theme === "dark" ? "-dark" : ""}.png`);
  if (shot.full) {
    // Grow the window to the page instead of a full-page stitch, so the app menu fills the height like it would on a tall screen.
    const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    await page.setViewportSize({ width: SIZES[vp].width, height: Math.min(Math.max(h, SIZES[vp].height), 4000) });
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: file });
}

main().catch((e) => { console.error(e); process.exit(1); });
