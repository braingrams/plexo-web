/** Made-up marketplace designs for the development preview (/welcome/setup/dev), so the picker can be seen without a database. */
import type { MarketplaceListItem } from "@/lib/marketplace";

const PAGE = (bg: string, fg: string, title: string, sub: string) =>
  `<!doctype html><html><body style="margin:0;font-family:system-ui,sans-serif;background:${bg};color:${fg}"><div style="padding:40px 64px;display:flex;justify-content:space-between;font-weight:700"><span>${title}</span><span style="opacity:.7">Home &nbsp; About &nbsp; Contact</span></div><div style="padding:120px 64px"><h1 style="font-size:72px;margin:0 0 16px;max-width:760px">${title}: ${sub}</h1><p style="font-size:24px;opacity:.75;max-width:620px">A made-up page for the preview.</p><span style="display:inline-block;margin-top:24px;padding:16px 28px;border-radius:12px;background:${fg};color:${bg};font-weight:700">Get started</span></div></body></html>`;

const ROWS: [string, string | null, number, string, string, string, number][] = [
  ["Boutique", "Online shop", 0, "#fff7ed", "#7c2d12", "Beautiful things, delivered", 14],
  ["Market Day", "Online store", 1500, "#ecfdf5", "#064e3b", "Fresh from the market", 9],
  ["Atelier", "Fashion shop", 2900, "#faf5ff", "#581c87", "Made with care", 4],
  ["Slate", "Business", 0, "#f1f5f9", "#0f172a", "Work that speaks for itself", 22],
  ["Harbor", "Agency", 3900, "#eff6ff", "#1e3a8a", "We build brands that last", 7],
  ["Kitchen Table", "Restaurant", 0, "#fefce8", "#713f12", "Come hungry", 11],
  ["Notebook", "Blog", 0, "#fafaf9", "#292524", "Stories worth your time", 6],
  ["Daily Ink", "Magazine", 1200, "#fef2f2", "#7f1d1d", "Read something good today", 3],
  ["Learn Loop", "Course", 4900, "#f0fdfa", "#134e4a", "Learn at your own pace", 5],
  ["Launchpad", "Landing page", 0, "#eef2ff", "#312e81", "Your idea, live this week", 18],
  ["Spark", "Event", 900, "#fff1f2", "#881337", "Save the date", 2],
  ["Linktree-ish", "Creator", 0, "#f0f9ff", "#0c4a6e", "Everything in one link", 13],
];

export const FIXTURE_DESIGNS: MarketplaceListItem[] = ROWS.map(([name, category, priceCents, bg, fg, sub, uses], i) => ({
  id: `fx-${i + 1}`,
  name,
  kind: "LANDING_PAGE",
  category,
  description: `${sub}.`,
  priceCents,
  publishedAt: `2026-0${(i % 9) + 1}-10`,
  purchaseCount: uses,
  compiledHtml: PAGE(bg, fg, name, sub),
}));
