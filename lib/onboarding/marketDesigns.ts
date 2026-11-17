/**
 * Pure logic behind "See all designs" in onboarding (and any "create a website" flow that reuses
 * app/dashboard/_v3/designs/DesignPicker): which real marketplace designs suit an owner's goal,
 * in what order, how each is labelled (Free / price) and which quick filters apply.
 * Marketplace prices are stored and charged in US dollars (see the purchase route), so that is what is shown.
 */
import type { SolBuildGoal } from "@/lib/ai/solBuildContext";

/** The slice of a marketplace listing this logic needs. */
export type MarketListing = {
  id: string;
  name: string;
  kind: "EMAIL" | "LANDING_PAGE";
  category: string | null;
  description: string | null;
  priceCents: number;
  purchaseCount: number;
  publishedAt: string | null;
};

export type OwnerHints = { name?: string; about?: string; industry?: string };

/** Words that mark a design as a good fit for each goal (matched against its category, name and description). */
const GOAL_WORDS: Record<string, string[]> = {
  store: ["shop", "store", "ecommerce", "e-commerce", "product", "boutique", "fashion", "retail", "market", "sell"],
  "business-site": ["business", "company", "agency", "service", "consult", "restaurant", "salon", "studio", "portfolio", "local", "corporate", "cafe", "clinic"],
  blog: ["blog", "magazine", "news", "writer", "writing", "journal", "article", "story", "editorial"],
  course: ["course", "education", "learn", "school", "class", "academy", "coach", "training", "tutor", "lesson"],
  landing: ["landing", "launch", "app", "saas", "startup", "event", "promo", "waitlist", "campaign", "webinar"],
  "link-in-bio": ["link", "bio", "creator", "profile", "personal", "influencer", "portfolio", "card"],
};

export function goalWords(goal: SolBuildGoal | string | undefined): string[] {
  const g = goal === "explore" || !goal ? "business-site" : goal;
  return GOAL_WORDS[g] ?? GOAL_WORDS["business-site"];
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "you", "our", "are", "sell", "make", "have", "i", "a", "an", "of", "in", "to", "my"]);

/** Meaningful words from what the owner told us about their business (name excluded: it matches nothing useful). */
export function ownerWords(h: OwnerHints): string[] {
  const text = `${h.industry ?? ""} ${h.about ?? ""}`.toLowerCase();
  return Array.from(new Set(text.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))).slice(0, 12);
}

/** Higher is a better fit. Category counts most (it is what the seller chose), then name, then description. */
export function fitScore(l: MarketListing, goal: SolBuildGoal | string | undefined, hints: OwnerHints = {}): number {
  const cat = (l.category ?? "").toLowerCase();
  const name = l.name.toLowerCase();
  const desc = (l.description ?? "").toLowerCase();
  let s = 0;
  for (const w of goalWords(goal)) {
    if (cat.includes(w)) s += 4;
    if (name.includes(w)) s += 3;
    if (desc.includes(w)) s += 1;
  }
  for (const w of ownerWords(hints)) {
    if (cat.includes(w)) s += 3;
    if (name.includes(w)) s += 2;
    if (desc.includes(w)) s += 1;
  }
  return s;
}

/** A listing counts as "best fit" once it clearly matches the goal. */
export const BEST_FIT_SCORE = 4;

export type RankedListing<T extends MarketListing = MarketListing> = T & { score: number; bestFit: boolean };

/** Web page designs only (never email), best fit first, then most used, then newest. */
export function rankListings<T extends MarketListing>(items: T[], goal: SolBuildGoal | string | undefined, hints: OwnerHints = {}): RankedListing<T>[] {
  return items
    .filter((l) => l.kind === "LANDING_PAGE")
    .map((l) => {
      const score = fitScore(l, goal, hints);
      return { ...l, score, bestFit: score >= BEST_FIT_SCORE };
    })
    .sort((a, b) => b.score - a.score || b.purchaseCount - a.purchaseCount || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.name.localeCompare(b.name));
}

export type PickerFilters = { q?: string; price?: "free" | "paid"; category?: string };

export function filterListings<T extends MarketListing>(items: T[], f: PickerFilters): T[] {
  const q = f.q?.trim().toLowerCase();
  return items.filter((l) => {
    if (f.price === "free" && l.priceCents > 0) return false;
    if (f.price === "paid" && l.priceCents <= 0) return false;
    if (f.category && l.category !== f.category) return false;
    if (q && !`${l.name} ${l.category ?? ""} ${l.description ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Up to `max` categories, most common first, for the quick-filter chips. */
export function topCategories(items: MarketListing[], max = 6): string[] {
  const n = new Map<string, number>();
  for (const l of items) if (l.category) n.set(l.category, (n.get(l.category) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([c]) => c);
}

/** "Free" or "$12.50". An owned paid design says "You own this". */
export function priceBadge(priceCents: number, owned = false): { label: string; free: boolean } {
  if (priceCents <= 0) return { label: "Free", free: true };
  if (owned) return { label: "You own this", free: false };
  return { label: `$${(priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 2)}`, free: false };
}

/** The button on a card: what happens when they choose it. */
export function useLabel(priceCents: number, owned: boolean): string {
  if (priceCents <= 0 || owned) return "Use this design";
  return `Buy for ${priceBadge(priceCents).label} and use`;
}

export function paginate<T>(items: T[], page: number, size: number): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return { items: items.slice((p - 1) * size, p * size), page: p, pageCount };
}

/**
 * Where Stripe sends someone back to after paying for a design in onboarding. Only the setup page and the dashboard's "Make a new website" page
 * are allowed (never an open redirect); the paid design id rides along so setup can finish.
 */
export function onboardingReturnPath(returnTo: unknown, designId: string): string | null {
  if (typeof returnTo !== "string") return null;
  const m = /^(?:\/welcome\/setup|\/dashboard\/sites\/new)(\?new=1)?$/.exec(returnTo);
  if (!m) return null;
  const sep = m[1] ? "&" : "?";
  return `${returnTo}${sep}paidDesign=${encodeURIComponent(designId)}`;
}
