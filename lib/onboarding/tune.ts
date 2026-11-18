/**
 * "Let's tune Plexo to you": the short setup for people who already have sites (no site is made,
 * no design is picked). Pure: the choices, the default site, and the message SOL starts from.
 * Tested in tests/onboardingTune.test.ts.
 */
import { CURRENT_SITE_COOKIE, pickCurrentSite, type SiteSummary } from "@/lib/dashboardV3/sites";

export type TuneActionId = "look" | "words" | "page" | "fix" | "around";

export const TUNE_ACTIONS: { id: TuneActionId; title: string; text: string }[] = [
  { id: "look", title: "Give it a fresh look", text: "New colours, fonts and spacing, same content." },
  { id: "words", title: "Improve the words", text: "Clearer headings, friendlier text, fewer typos." },
  { id: "page", title: "Add a page", text: "A shop, pricing, a blog, contact or anything else." },
  { id: "fix", title: "Fix something", text: "Something looks wrong or doesn't work yet." },
  { id: "around", title: "Just let me look around", text: "No changes now. Take me to my dashboard." },
];

const ASK: Record<Exclude<TuneActionId, "around">, string> = {
  look: "give it a fresh look (colours, fonts and spacing) without losing any of my content",
  words: "improve the words on it: clearer headings, friendlier text and no typos",
  page: "add a new page to it (a shop, pricing, a blog or similar)",
  fix: "fix something that looks wrong or doesn't work",
};

/** The site they probably want: the most recently edited, unless they've picked one before. */
export function defaultTuneSite(sites: SiteSummary[], cookieValue?: string | null): SiteSummary | null {
  const recent = [...sites].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0] ?? null;
  return cookieValue ? pickCurrentSite(sites, cookieValue) : recent;
}

/**
 * What SOL is asked first. It names the site and tells SOL to look at it before changing anything
 * (find_page then page_describe), so SOL starts from the real page, not a guess.
 */
export function tuneDraft(site: Pick<SiteSummary, "id" | "name">, action: TuneActionId | "", freeText: string): string {
  const note = freeText.replace(/\s+/g, " ").trim().slice(0, 600);
  const want = action && action !== "around" ? ASK[action] : "";
  const goal = [want && `I'd like to ${want}.`, note && (want ? `More detail: ${note}` : note)].filter(Boolean).join(" ");
  return `I want to work on my site "${site.name}" (site id ${site.id}). First look at it with find_page, then page_describe, so you know what's on it before you change anything. ${goal || "Tell me what you notice and what you'd improve first."}`.slice(0, 1900);
}

export function tuneSolHref(site: Pick<SiteSummary, "id" | "name">, action: TuneActionId | "", freeText: string): string {
  return `/dashboard/sol?new=1&draft=${encodeURIComponent(tuneDraft(site, action, freeText))}`;
}

export { CURRENT_SITE_COOKIE };
