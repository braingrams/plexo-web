// Picks the templates that fit what a person says their website is for, so the new-site step is not the same list for
// everyone. One tiny, platform-paid model call (the same cheap tier that titles conversations) ranks the free templates;
// if that call fails or is slow, a plain word-match ranking answers instead, so this never errors and never costs the owner credits.

import type { MarketplaceListItem } from "@/lib/marketplace";

export type TemplatePick = { id: string; reason: string };
export type Candidate = Pick<MarketplaceListItem, "id" | "name" | "category" | "description">;

export const MAX_PICKS = 6;
export const MIN_DESCRIPTION = 8;
export const MAX_DESCRIPTION = 600;

const STOP = new Set("a an and the for of to in on my our we i is are be with that this it as at by from your you want need make build create site website page business".split(" "));

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w));
}

/** Word-match ranking: the fallback, and the model's safety net. Templates with no matching words keep their popularity order. */
export function rankByKeywords(description: string, items: Candidate[]): TemplatePick[] {
  const wanted = new Set(words(description));
  const scored = items.map((t, i) => {
    const hay = words(`${t.name} ${t.category ?? ""} ${t.description ?? ""}`);
    const hits = hay.filter((w) => wanted.has(w));
    const categoryHit = t.category && words(t.category).some((w) => wanted.has(w)) ? 2 : 0;
    return { t, i, score: new Set(hits).size + categoryHit, hits: [...new Set(hits)] };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, MAX_PICKS).map(({ t, score, hits }) => ({
    id: t.id,
    reason: score > 0 ? `Made for ${hits.slice(0, 3).join(", ")}.` : "A popular, flexible starting point.",
  }));
}

export function buildRecommendPrompt(description: string, items: Candidate[]): string {
  const list = items.map((t) => `${t.id} | ${t.name} | ${t.category ?? "general"} | ${(t.description ?? "").replace(/\s+/g, " ").slice(0, 140)}`).join("\n");
  return `A person is setting up a website. They said it is for:\n"${description.slice(0, MAX_DESCRIPTION)}"\n\nThese are the templates (id | name | category | description):\n${list}\n\nPick the ${MAX_PICKS} templates that fit best, best first. Judge by what the business or purpose needs (for example a shop needs product sections, a clinic needs bookings and trust, a church needs events). Reply with ONLY a JSON array like [{"id":"...","reason":"one short plain sentence, max 14 words, why it fits"}]. Use only ids from the list.`;
}

/** Reads the model's reply defensively: only known ids, no repeats, short reasons. Returns [] when unusable. */
export function parsePicks(text: string, valid: Set<string>): TemplatePick[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: TemplatePick[] = [];
    for (const r of raw) {
      const id = typeof (r as { id?: unknown })?.id === "string" ? (r as { id: string }).id.trim() : "";
      if (!valid.has(id) || seen.has(id)) continue;
      seen.add(id);
      const reason = typeof (r as { reason?: unknown }).reason === "string" ? (r as { reason: string }).reason.replace(/\s+/g, " ").trim().slice(0, 120) : "";
      out.push({ id, reason: reason || "A good fit for what you described." });
      if (out.length >= MAX_PICKS) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Fills up to MAX_PICKS using the word-match ranking when the model returned fewer (or none). */
export function completePicks(picks: TemplatePick[], description: string, items: Candidate[]): TemplatePick[] {
  if (picks.length >= MAX_PICKS) return picks.slice(0, MAX_PICKS);
  const have = new Set(picks.map((p) => p.id));
  const extra = rankByKeywords(description, items.filter((t) => !have.has(t.id)));
  return [...picks, ...extra].slice(0, MAX_PICKS);
}
