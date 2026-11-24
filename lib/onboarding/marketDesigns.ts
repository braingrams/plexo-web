/**
 * Pure logic behind "See all designs" in onboarding (and any "create a website" flow that reuses
 * app/dashboard/_v3/designs/DesignPicker): which real marketplace designs suit an owner's goal,
 * in what order, how each is labelled (Free / price) and which quick filters apply.
 * Marketplace prices are stored and charged in US dollars (see the purchase route), so that is what is shown.
 */
import type { SolBuildGoal } from "@/lib/ai/solBuildContext";
import { inferBusinessType, typeFit } from "@/lib/onboarding/businessType";

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

export type OwnerHints = {
  name?: string;
  about?: string;
  industry?: string;
  /** The kind of business (lib/onboarding/businessType.ts): chosen by the owner or read by SOL. Guessed from the words when missing. */
  type?: string;
};

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

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "you", "our", "are",
  "sell", "make", "have", "i", "a", "an", "of", "in", "to", "my",
  "want", "wants", "like", "users", "what", "them", "they", "need", "needs",
  "look", "looks", "good", "best", "some", "also", "just", "into", "onto",
  "help", "about", "their", "site", "website", "would", "could", "should",
  "very", "easy", "clean", "simple", "shows", "show", "allow", "allows", "people", "reach", "service", "services", "does", "what", "when", "where", "which", "make", "makes", "using", "used", "want", "wants", "modern", "nice", "beautiful", "professional", "looking", "something", "everything", "anything", "business", "company", "online", "page", "pages", "built", "build", "create", "creating", "customers", "clients", "visitors", "user", "users"
]);

/** Meaningful words from what the owner told us about their business (name excluded: it matches nothing useful). */
export function ownerWords(h: OwnerHints): string[] {
  const text = `${h.industry ?? ""} ${h.about ?? ""}`.toLowerCase();
  // Four letters or more, plus the short words that name a kind of business ("gym", "spa", "dj").
  return Array.from(new Set(text.split(/[^a-z0-9]+/).filter((w) => !STOP.has(w) && (w.length >= 4 || DOMAIN_WORDS.has(w))))).slice(0, 16);
}

/** True when `word` appears as a whole word (or its plural) in `text`: "app" is not found in "happy", "ai" not in "main". */
export function hasWord(text: string, word: string): boolean {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${w}(s|es)?($|[^a-z0-9])`).test(text);
}

/** Domain ontology clusters for deep semantic matching and cross-domain penalty */
export const DOMAIN_CLUSTERS: Record<string, { keywords: string[]; penaltyKeywords: string[] }> = {
  music: {
    keywords: [
      "music", "musician", "artist", "singer", "band", "song", "album", "tour",
      "shows", "show", "performance", "performances", "concert", "gig", "spotify",
      "soundcloud", "audio", "track", "stage", "live", "dj", "producer", "vocalist",
      "festival", "listen", "listener", "listeners"
    ],
    penaltyKeywords: [
      "recipe", "recipes", "cookbook", "culinary", "kitchen", "focaccia", "fusilli", "pasta"
    ],
  },
  food: {
    keywords: [
      "food", "chef", "cook", "cooking", "recipe", "recipes", "kitchen", "restaurant",
      "supper", "bistro", "dining", "bakery", "cafe", "dish", "dishes", "meal", "meals", "baking", "culinary"
    ],
    penaltyKeywords: [
      "album", "spotify", "concert", "gig", "track", "vocalist"
    ],
  },
  health: {
    keywords: [
      "wellness", "clinic", "health", "healthcare", "doctor", "dental", "dentist", "therapy", "therapist", "counselling",
      "care", "nursing", "nurse", "carer", "carers", "patient", "medical", "hospital", "mental", "physio", "physiotherapy"
    ],
    penaltyKeywords: [
      "recipe", "recipes", "concert", "album", "gym", "workout", "crossfit", "strength"
    ],
  },
  fitness: {
    keywords: [
      "fitness", "gym", "gyms", "trainer", "personal trainer", "workout", "workouts", "crossfit", "pilates", "yoga",
      "boxing", "bootcamp", "strength", "athlete", "exercise", "weights", "powerlifting", "martial arts"
    ],
    penaltyKeywords: [
      "nursing", "carer", "carers", "patient", "dental", "recipe", "recipes", "concert", "album"
    ],
  },
  creative: {
    keywords: [
      "illustrator", "illustration", "drawing", "painting", "photographer",
      "photography", "filmmaker", "director", "designer", "design", "gallery",
      "portfolio", "architect", "architecture"
    ],
    penaltyKeywords: [
      "recipe", "recipes", "cookbook"
    ],
  },
  tech: {
    keywords: [
      "software", "tech", "saas", "app", "developer", "platform", "ai", "coding",
      "bootcamp", "terminal", "api", "code"
    ],
    penaltyKeywords: [
      "recipe", "recipes", "cookbook", "dish"
    ],
  },
  store: {
    keywords: [
      "store", "shop", "ecommerce", "product", "products", "apparel", "clothing",
      "candles", "furniture", "skincare", "merch", "retail", "boutique"
    ],
    penaltyKeywords: [],
  },
  education: {
    keywords: [
      "course", "courses", "coach", "coaching", "academy", "mastermind", "training",
      "cohort", "education", "lesson", "lessons", "school"
    ],
    penaltyKeywords: [],
  },
};

/** Every single word the domain clusters know (so a three-letter one like "gym" is kept as an owner word). */
const DOMAIN_WORDS = new Set(Object.values(DOMAIN_CLUSTERS).flatMap((c) => c.keywords.filter((k) => !k.includes(" "))));

/** Higher is a better fit. Category counts most (it is what the seller chose), then name, then description. */
export function fitScore(l: MarketListing, goal: SolBuildGoal | string | undefined, hints: OwnerHints = {}): number {
  const cat = (l.category ?? "").toLowerCase();
  const name = l.name.toLowerCase();
  const desc = (l.description ?? "").toLowerCase();
  const listingText = `${cat} ${name} ${desc}`;
  const ownerText = `${hints.industry ?? ""} ${hints.about ?? ""}`.toLowerCase();

  let s = 0;

  // 0. The kind of business: the same type as the design is by far the strongest signal, then a related one.
  // With no type given, a strong word in the name or description ("gym", "dental", "church") is enough to know.
  const guess = hints.type ? null : inferBusinessType(hints.name, hints.industry, hints.about);
  const ownerType = hints.type ?? (guess && (guess.score >= 5 || (guess.score >= 3 && guess.margin >= 1.5)) ? guess.id : undefined);
  s += typeFit(ownerType, l, typeof goal === "string" ? goal : undefined);

  // 1. Goal words matching (capped at 8 so generic "link in bio creator" terms don't overpower domain fit)
  let goalScore = 0;
  for (const w of goalWords(goal)) {
    if (cat.includes(w)) goalScore += 4;
    if (name.includes(w)) goalScore += 3;
    if (desc.includes(w)) goalScore += 1;
  }
  s += Math.min(goalScore, 8);

  // 2. Direct owner words matching
  for (const w of ownerWords(hints)) {
    if (hasWord(cat, w)) s += 4;
    if (hasWord(name, w)) s += 3;
    if (hasWord(desc, w)) s += 2;
  }

  // 3. Deep semantic domain affinity & cross-domain mismatch detection
  // The older word clusters only step in when the kind of business could not be told: otherwise they double-count generic words.
  for (const [domain, cluster] of ownerType ? [] : Object.entries(DOMAIN_CLUSTERS)) {
    const ownerMatchesDomain = cluster.keywords.some((k) => hasWord(ownerText, k));
    const listingMatchesDomain = cluster.keywords.some((k) => hasWord(listingText, k));

    if (ownerMatchesDomain && listingMatchesDomain) {
      // Direct strong domain affinity boost (e.g. music artist -> musician template)
      s += 30;
      // Extra affinity if category or name matches
      if (cluster.keywords.some((k) => hasWord(cat, k) || hasWord(name, k))) {
        s += 16;
      }
      // Extra affinity when multiple domain keywords match between owner and listing
      const sharedMatches = cluster.keywords.filter((k) => hasWord(ownerText, k) && hasWord(listingText, k)).length;
      s += sharedMatches * 10;
    } else if (ownerMatchesDomain && !listingMatchesDomain) {
      // Listing belongs to a conflicting/mismatched domain with penalty keywords
      const hasPenalty = cluster.penaltyKeywords.some((pk) => hasWord(listingText, pk));
      if (hasPenalty) {
        s -= 30; // Heavy penalty: food/recipe template when owner is an artist/musician
      }
    }
  }

  return Math.max(0, s);
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
