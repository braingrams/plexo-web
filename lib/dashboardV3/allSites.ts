/**
 * The "all my sites" dashboard: the colourful, one-screen view of every site with quick actions. Pure helpers
 * (which actions a card offers, what colour it wears) so the rules are tested once.
 */
import type { SiteKindLabel } from "./sites";

export const ALL_SITES_PATH = "/dashboard/sites/all";

export type CardAction = { id: "edit" | "view" | "share" | "product" | "orders" | "post" | "lessons"; label: string; href?: string; external?: boolean };

export type CardSite = { id: string; kind: string; status: "live" | "draft" | string; address?: string | null; sells?: boolean };

/**
 * The quick actions a site's card offers. Edit is always first; "View" only when it is online (a preview otherwise);
 * Share only with a live address; the shop actions only for a store. Never a button that goes nowhere.
 */
export function cardActions(s: CardSite, hrefs: { edit: string; preview: string; live: string | null; product: string; orders: string; post: string; lessons: string }): CardAction[] {
  const out: CardAction[] = [{ id: "edit", label: "Edit", href: hrefs.edit }];
  out.push(hrefs.live ? { id: "view", label: "View", href: hrefs.live, external: true } : { id: "view", label: "Preview", href: hrefs.preview, external: true });
  if (hrefs.live && s.address) out.push({ id: "share", label: "Share" });
  const store = s.sells || s.kind === "Online store";
  if (store) {
    out.push({ id: "product", label: "Add product", href: hrefs.product });
    out.push({ id: "orders", label: "Orders", href: hrefs.orders });
  } else if (s.kind === "Blog") out.push({ id: "post", label: "Write a post", href: hrefs.post });
  else if (s.kind === "Course") out.push({ id: "lessons", label: "Add a lesson", href: hrefs.lessons });
  return out;
}

/** A site's colour: its own brand colour when it has one, otherwise a steady, friendly colour picked from its name (the same name always gets the same one). */
const FALLBACKS = ["#F59E0B", "#EC4899", "#14B8A6", "#06B6D4", "#10B981", "#F97316", "#3B82F6", "#EF4444"];
export function siteColour(name: string, brand?: string | null): string {
  if (brand && /^#[0-9a-f]{3,8}$/i.test(brand)) return brand;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length];
}

/** A readable text colour (black or white) on top of `bg`. */
export function onColour(bg: string): "#111111" | "#ffffff" {
  const hex = bg.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return "#ffffff";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111111" : "#ffffff";
}

/** The sentence at the top: "You have 4 sites. 3 are online." */
export function summaryLine(total: number, live: number): string {
  if (total === 0) return "You have no sites yet.";
  const sites = `${total} ${total === 1 ? "site" : "sites"}`;
  if (live === 0) return `You have ${sites}. None are online yet.`;
  if (live === total) return total === 1 ? "You have 1 site and it is online." : `You have ${sites} and every one is online.`;
  return `You have ${sites}. ${live} ${live === 1 ? "is" : "are"} online.`;
}

export type { SiteKindLabel };
