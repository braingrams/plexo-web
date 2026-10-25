/** Local preview: compiles every page and serves it with the site's scripts and sample content, for screenshots. No database. */
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { compileV2Design } from "../../lib/v2/compile";
import { blogCards, blogLayouts, designFor, sitePages, SAMPLE_EVENTS, SAMPLE_STORIES, SAMPLE_VIDEOS, BLOG_POSTS } from "./site";
import { setContentMode, setMultiPage, type SiteImages } from "./design";
setMultiPage(process.env.PREVIEW_SINGLE !== "1");
setContentMode((process.env.PREVIEW_MODE as "html" | "static") ?? "html");

const assets = process.env.ASSET_OUT as string; // …/assets/out
const outDir = process.env.PREVIEW_OUT as string;
const port = 4599;
const base = `http://localhost:${port}`;
const a = (f: string) => `${base}/assets/${f}`;
const img: SiteImages = {
  logo: a("logo.png"), hero: a("hero-bg.jpg"), heroMobile: a("hero-mobile.jpg"), cta: a("cta-bg.jpg"), leaf: a("footer-leaf.png"), videoThumb: a("video-thumb.jpg"), favicon: a("favicon.png"), og: a("og.jpg"), scriptFont: a("OoohBaby.woff2"),
  blog: { listening: a("blog-1.jpg"), everyday: a("blog-2.jpg"), resilience: a("blog-3.jpg") },
};

const pages = sitePages(img, { contentBlock: process.env.PREVIEW_MODE !== "static" });
const compiled = new Map<string, string>();
for (const spec of pages) {
  const html = compileV2Design(designFor(spec, img), { rootTemplateId: "preview", pageTemplateId: spec.slug, name: spec.name });
  compiled.set(spec.isHome ? "/" : `/${spec.slug}`, html);
}
const layouts = blogLayouts(img);
for (const [k, spec] of Object.entries(layouts)) {
  compiled.set(`/__${k}`, compileV2Design(designFor(spec, img), { rootTemplateId: "preview", pageTemplateId: spec.slug, name: spec.name }));
}

const fixtures: Record<string, unknown[]> = {
  videos: SAMPLE_VIDEOS(img.videoThumb, img), stories: SAMPLE_STORIES(img), happenings: SAMPLE_EVENTS(img),
  blog: blogCards(img).map((c) => ({ title: c.title, dateLabel: c.date, link: c.href, image: c.image, imageAlt: c.alt, description: "" })),
};

const unframe = (html: string) =>
  html.replace(/<iframe srcdoc="([^"]*data-plexo-content[^"]*)"[^>]*><\/iframe>/g, (_m, enc: string) => enc.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
const inject = (html: string) => unframe(html).replace("</body>", `<script src="/plexo-content.js" defer></script><script src="/plexo-forms.js" data-template-id="preview" data-auto="true" defer></script></body>`);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", base);
  const p = url.pathname;
  if (p.startsWith("/assets/")) { const f = path.join(assets, p.slice(8)); if (existsSync(f)) { res.writeHead(200, { "Content-Type": f.endsWith(".png") ? "image/png" : "image/jpeg" }); return void res.end(readFileSync(f)); } }
  if (p === "/plexo-content.css" && existsSync("public/plexo-content.css")) { res.writeHead(200, { "Content-Type": "text/css" }); return void res.end(readFileSync("public/plexo-content.css")); }
  if (p === "/plexo-content.js" || p === "/plexo-forms.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return void res.end(readFileSync(path.join("public", p))); }
  const m = /^\/api\/public\/content\/[^/]+\/([^/]+)$/.exec(p);
  if (m) { res.writeHead(200, { "Content-Type": "application/json" }); return void res.end(JSON.stringify({ entries: (fixtures[m[1]] ?? []).map((e, i) => ({ id: String(i), ...(e as object) })) })); }
  const html = compiled.get(p);
  if (html) { res.writeHead(200, { "Content-Type": "text/html" }); return void res.end(inject(html)); }
  res.writeHead(404); res.end("not found");
});

server.listen(port, async () => {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const only = process.argv.slice(2);
  const targets = [...compiled.keys()].filter((k) => !only.length || only.includes(k));
  for (const vp of [{ n: "d", w: 1024 }, { n: "w", w: 1440 }, { n: "t", w: 820 }, { n: "m", w: 390 }]) {
    if (only.length && !process.env.ALL_VIEWPORTS && vp.n !== "d") continue;
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: 900 } });
    for (const t of targets) {
      const pg = await ctx.newPage();
      const errors: string[] = [];
      pg.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
      pg.on("pageerror", (e) => errors.push(String(e)));
      pg.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await pg.goto(base + t, { waitUntil: "networkidle" });
      await pg.waitForTimeout(400);
      const name = (t === "/" ? "home" : t.replace(/\W+/g, "")) + "-" + vp.n;
      await pg.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
      const h1 = await pg.locator("h1").count();
      if (errors.length || h1 !== 1) console.log(name, "h1:", h1, errors.slice(0, 3));
      await pg.close();
    }
    await ctx.close();
  }
  await browser.close();
  writeFileSync(path.join(outDir, "ok"), "1");
  console.log("done", targets.length, "pages");
  server.close();
});
void BLOG_POSTS;
