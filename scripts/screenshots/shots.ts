import type { Page } from "playwright-core";

export type Shot = {
  area: string;
  name: string;
  path: string;
  viewports?: ("desktop" | "phone" | "wide1280")[];
  themes?: ("light" | "dark")[];
  full?: boolean;
  /** Served by the plexo-admin preview (`/preview` in that repo, branch feat/signup-source-broadcast-filter). */
  admin?: boolean;
  wait?: number;
  /** Runs before the page opens (page.route etc). */
  setup?: (page: Page) => Promise<void>;
  act?: (page: Page) => Promise<void>;
};

const PIXEL = `<!-- Meta Pixel Code -->\n<script>\n!function(f,b,e,v,n,t,s){n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');\nfbq('init','1029384756');fbq('track','PageView');\n</script>\n<noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=1029384756&ev=PageView&noscript=1"/></noscript>`;
const BAD = `<script>\n  window.chat = { id: "abc123" };\n`;
const paste = (text: string) => async (p: Page) => { await p.locator("textarea").first().fill(text); await p.waitForTimeout(1200); };
const DRAFT = { title: "Five spices every kitchen needs", excerpt: "A short, friendly guide to the spices that make everyday cooking easier.", metaTitle: "Five spices every kitchen needs", metaDescription: "The five spices we reach for every day.", categories: ["Cooking"], tags: ["spices", "basics"], imagePrompt: "A wooden table with five bowls of colourful spices", contentHtml: "<p>Every good kitchen starts with a few reliable spices. Here are the five we reach for every single day.</p><h2>1. Scotch bonnet</h2><p>Heat with a fruity edge. A little goes a long way, so start with half a pepper.</p><h2>2. Grains of selim</h2><p>Smoky, peppery and wonderful in soups and stews.</p><h2>3. Suya spice</h2><p>Peanut, ginger and chilli. Rub it on anything you plan to grill.</p>" };
const streamDone = async (p: Page) => { await p.route("**/api/v1/ai/stream/generate", (r) => r.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "progress", characters: 1500, attempt: 1 }) + "\n" + JSON.stringify({ type: "done", summary: "Drafted a post", result: DRAFT }) + "\n" })); };
const streamHang = async (p: Page) => { await p.route("**/api/v1/ai/stream/generate", () => new Promise(() => undefined)); };
const askSol = async (p: Page) => { await p.getByRole("button", { name: /Write with SOL/ }).first().click(); await p.getByLabel(/What should it be about/).fill("Five spices every kitchen needs, in a warm and simple tone"); };
const writeIt = async (p: Page) => { await askSol(p); await p.getByRole("button", { name: /Write it/ }).click(); await p.waitForTimeout(1200); };
const pick = (label: string) => async (p: Page) => { await p.getByText(label, { exact: true }).first().click(); };
const click = (text: string | RegExp) => async (p: Page) => { await p.getByRole("button", { name: text }).first().click(); };

export const SHOTS: Shot[] = [
  { area: "pages", name: "pages-grid", path: "/v3-preview/hub?kind=store&exp=beginner", viewports: ["desktop", "phone"], themes: ["light", "dark"], act: pick("Grid") },
  { area: "pages", name: "pages-list", path: "/v3-preview/hub?kind=store&exp=beginner", viewports: ["desktop", "phone"], themes: ["light", "dark"], act: pick("List") },
  { area: "pages", name: "pages-grid-free", path: "/v3-preview/hub?kind=store&exp=beginner&plan=free", viewports: ["desktop", "phone"], act: pick("Grid") },
  { area: "pages", name: "pages-list-free", path: "/v3-preview/hub?kind=store&exp=beginner&plan=free", viewports: ["desktop", "phone"], act: pick("List") },
  { area: "newsite", name: "describe-your-website", path: "/v3-preview/newsite?screen=goal&mock=1", viewports: ["desktop", "phone"], act: async (page) => { await page.getByRole("radio", { name: /Website for my business/ }).click(); await page.getByLabel(/Briefly describe what you want your website to look like/).fill("A warm, friendly bakery in Lagos that takes cake orders and shows lots of photos"); } },
  { area: "pages", name: "pages-more-menu", path: "/v3-preview/hub?kind=store&exp=beginner", act: click(/More/) },
  { area: "blog", name: "blog-tab", path: "/v3-preview/hub?kind=blog&tab=blog", viewports: ["desktop", "phone"] },
  { area: "settings", name: "site-settings", path: "/v3-preview/hub?kind=store&tab=settings", viewports: ["desktop", "phone"] },
  { area: "home", name: "home-guided", path: "/v3-preview/home?state=guided&step=2", viewports: ["desktop", "phone"], themes: ["light", "dark"] },

  // Site layout
  { area: "site-layout", name: "old-site-blank", path: "/v3-preview/site-layout?scenario=old", viewports: ["desktop", "phone"], full: true },
  { area: "site-layout", name: "old-site-pick-a-look", path: "/v3-preview/site-layout?scenario=old", full: true, act: click(/Add a header/) },
  { area: "site-layout", name: "designed-header-footer", path: "/v3-preview/site-layout?scenario=designed", viewports: ["desktop", "phone"], full: true, themes: ["light", "dark"] },
  { area: "site-layout", name: "per-page-switches", path: "/v3-preview/site-layout?scenario=page", viewports: ["desktop"] },
  { area: "site-layout", name: "custom-code-no-domain", path: "/v3-preview/site-layout?scenario=nodomain", full: true },
  { area: "site-layout", name: "custom-code-plan-blocked", path: "/v3-preview/site-layout?scenario=plan", full: true },
  { area: "site-layout", name: "custom-code-bad-snippet", path: "/v3-preview/site-layout?scenario=badcode", full: true, act: paste(BAD) },
  { area: "site-layout", name: "custom-code-meta-pixel", path: "/v3-preview/site-layout?scenario=pixel", full: true, act: paste(PIXEL) },

  // Editor: Design | Code | Text
  { area: "editor", name: "code-view", path: "/v3-preview/editor?view=code", viewports: ["desktop", "phone"], wait: 2500 },
  { area: "editor", name: "code-autocomplete", path: "/v3-preview/editor?view=code", wait: 2500, act: async (p) => { const ed = p.locator(".cm-content").first(); await ed.click(); await p.keyboard.press("Control+End"); await p.keyboard.type("\n<se"); await p.keyboard.press("Control+Space"); await p.waitForTimeout(800); } },
  { area: "editor", name: "text-view", path: "/v3-preview/editor?view=text", viewports: ["desktop", "phone"], wait: 2500 },
  { area: "editor", name: "design-view-click-to-edit", path: "/v3-preview/editor?view=design", wait: 2500, act: async (p) => { await p.frameLocator("iframe").first().locator("h1").first().click().catch(() => undefined); } },
  { area: "editor", name: "switch-warning", path: "/v3-preview/editor?view=code&script=1", wait: 2500, act: async (p) => { await p.getByRole("radio", { name: /Text/ }).first().click(); } },
  { area: "editor", name: "convert-to-code-dialog", path: "/v3-preview/editor?view=convert", wait: 2000, viewports: ["desktop", "phone"] },

  // Custom sections
  { area: "sections", name: "your-sections-list", path: "/v3-preview/sections?view=list", viewports: ["desktop", "phone"] },
  { area: "sections", name: "your-sections-empty", path: "/v3-preview/sections?view=empty" },
  { area: "sections", name: "make-a-section", path: "/v3-preview/sections?view=make", full: true, wait: 2500, viewports: ["desktop", "phone"] },
  { area: "sections", name: "make-a-section-describe-it", path: "/v3-preview/sections?view=make", full: true, wait: 2500, act: async (p) => { await p.getByPlaceholder(/describe|idea|e\.g\./i).first().fill("A row of team photos with names and roles").catch(() => undefined); await p.getByRole("button", { name: /draft|describe|make it/i }).first().click().catch(() => undefined); await p.waitForTimeout(800); } },
  { area: "sections", name: "entries-list", path: "/v3-preview/sections?view=entries", viewports: ["desktop", "phone"] },
  { area: "sections", name: "entries-search", path: "/v3-preview/sections?view=entries", act: async (p) => { await p.getByPlaceholder(/search/i).first().fill("class"); await p.waitForTimeout(700); } },
  { area: "sections", name: "entries-edit-in-place", path: "/v3-preview/sections?view=entries", viewports: ["desktop", "phone"], wait: 1500, act: async (p) => { await p.getByRole("button", { name: /edit|open|change/i }).first().click().catch(async () => { await p.getByText("What our students say").first().click(); }); await p.waitForTimeout(1500); } },
  { area: "sections", name: "entries-empty", path: "/v3-preview/sections?view=entries-empty" },

  // Blog
  { area: "blog", name: "blog-grid", path: "/v3-preview/hub?kind=blog&tab=blog&posts=8", viewports: ["desktop", "phone"], themes: ["light", "dark"] },
  { area: "blog", name: "blog-list", path: "/v3-preview/hub?kind=blog&tab=blog&posts=8", viewports: ["desktop", "phone"], act: pick("List") },
  { area: "blog", name: "blog-pagination", path: "/v3-preview/hub?kind=blog&tab=blog&posts=60", full: true, act: pick("List") },
  { area: "blog", name: "sol-write-prompt", path: "/v3-preview/hub?kind=blog&tab=blog&posts=8", viewports: ["desktop", "phone"], act: async (p) => { await askSol(p); await p.waitForTimeout(500); } },
  { area: "blog", name: "sol-write-writing", path: "/v3-preview/hub?kind=blog&tab=blog&posts=8", setup: streamHang, act: writeIt },
  { area: "blog", name: "sol-write-result", path: "/v3-preview/hub?kind=blog&tab=blog&posts=8", viewports: ["desktop", "phone"], setup: streamDone, act: writeIt },
  { area: "blog", name: "sol-write-out-of-credits", path: "/v3-preview/hub?kind=blog&tab=blog&posts=8&credits=0", viewports: ["desktop", "phone"], act: writeIt },

  // Home
  { area: "home", name: "home-simple-live", path: "/v3-preview/home?state=live&exp=beginner", viewports: ["desktop", "phone"], themes: ["light", "dark"], full: true },
  { area: "home", name: "home-my-sites-switcher", path: "/v3-preview/home?state=live&exp=beginner", viewports: ["desktop"], act: async (p) => { await p.getByRole("button", { name: /Ama's Kitchen/ }).first().click(); } },
  { area: "home", name: "home-finish-up-step", path: "/v3-preview/home?state=guided&step=4", viewports: ["desktop", "phone"], full: true },
  { area: "home", name: "all-my-sites-at-once", path: "/v3-preview/sites?view=board", viewports: ["desktop", "phone"], themes: ["light", "dark"], full: true, wait: 1500 },
  { area: "home", name: "delete-site-dialog", path: "/v3-preview/sites?view=board", viewports: ["desktop", "phone"], wait: 1200, act: async (p) => { await p.getByRole("button", { name: /Delete Ama's Kitchen/ }).first().click(); } },
  { area: "home", name: "change-the-words-step-1", path: "/v3-preview/sites?view=words&step=1", viewports: ["desktop", "phone"], wait: 1200 },
  { area: "home", name: "change-the-words-step-3", path: "/v3-preview/sites?view=words&for=contact&step=3", wait: 1200 },
  // Dashboard tour
  { area: "tour", name: "coach-mark", path: "/v3-preview/home?state=guided&step=2&tour=active", viewports: ["desktop", "phone"], wait: 2500 },
  { area: "tour", name: "tour-menu", path: "/v3-preview/home?state=live", viewports: ["desktop"], act: async (p) => { await p.getByRole("button", { name: /Take the tour/ }).first().click(); } },

  // WordPress moves
  { area: "wordpress", name: "settings-wordpress-moves", path: "/v3-preview/settings/migration", viewports: ["desktop", "phone"], themes: ["light", "dark"], full: true },
  { area: "wordpress", name: "settings-wordpress-moves-empty", path: "/v3-preview/settings/migration?moves=none" },
  { area: "wordpress", name: "rerun-confirm", path: "/v3-preview/settings/migration", viewports: ["desktop", "phone"], act: async (p) => { await p.getByRole("button", { name: /Blog posts again/ }).first().click(); await p.waitForTimeout(800); } },
  { area: "wordpress", name: "per-site-panel", path: "/v3-preview/hub?kind=moved&tab=settings", full: true, wait: 1500 },
  // Plan strip and plans
  { area: "plans", name: "plans-page-1280", path: "/v3-preview/settings/plan?plan=free", viewports: ["wide1280"], full: true },
  { area: "plans", name: "plans-page", path: "/v3-preview/settings/plan?plan=free", viewports: ["phone"], full: true },
  { area: "plans", name: "plans-paid-1280", path: "/v3-preview/settings/plan?plan=paid", viewports: ["wide1280"], full: true },
  { area: "plans", name: "plan-strip", path: "/v3-preview/plan-strip?case=free-pages", viewports: ["desktop", "phone"] },
  { area: "plans", name: "plan-strip-details", path: "/v3-preview/plan-strip?case=free-pages", viewports: ["desktop", "phone"], act: click(/Details/) },
  { area: "plans", name: "plan-strip-offline-details", path: "/v3-preview/plan-strip?case=offline", act: click(/Details/) },
  // Add more to your site
  { area: "tour", name: "add-more-cards", path: "/v3-preview/hub?kind=site&exp=beginner", viewports: ["desktop", "phone"], act: async (p) => { await p.getByRole("heading", { name: "Add more to your site" }).scrollIntoViewIfNeeded(); } },
  { area: "tour", name: "add-more-modal", path: "/v3-preview/hub?kind=site&exp=beginner", viewports: ["desktop", "phone"], act: async (p) => { await p.locator("button.plx-ao").first().click(); await p.waitForTimeout(600); } },
  { area: "tour", name: "add-more-modal-blog", path: "/v3-preview/hub?kind=site&exp=beginner", act: async (p) => { await p.locator("button.plx-ao").nth(1).click(); await p.waitForTimeout(600); } },
  // plexo-admin (needs its dev server on :3112, see the admin repo's app/preview)
  { area: "admin", name: "users-table-experience-column", path: "/preview?view=users", admin: true, viewports: ["desktop"], full: true },
  { area: "admin", name: "broadcast-audience-experience", path: "/preview?view=audience", admin: true, viewports: ["desktop"], act: async (p) => { await p.evaluate(() => document.querySelectorAll("*").forEach((e) => { if (e.scrollHeight > e.clientHeight + 20 && getComputedStyle(e).overflowY !== "visible") e.scrollTop = e.scrollHeight; })); } },
  { area: "admin", name: "broadcast-audience-joined-from", path: "/preview?view=audience", admin: true, viewports: ["desktop"], act: async (p) => { await p.evaluate(() => document.querySelectorAll("*").forEach((e) => { if (e.scrollHeight > e.clientHeight + 20 && getComputedStyle(e).overflowY !== "visible") e.scrollTop = 250; })); } },
];
