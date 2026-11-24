// Pure half (safe in the browser): the allowed words, the prompt and the reply reader. The model call is in understand.ts.
// Understands what someone typed about their website ("a bakery in Lagos that takes cake orders") so the designs we show
// fit THEM, not just the goal they ticked. One tiny, platform-paid model call (a few hundred tokens, the same cheap tier that
// titles chats) names the kind of business and the feel; the existing design ranking does the rest. Never throws: with no
// answer, the keyword reading of the description in lib/onboarding/designs.ts still applies.

import type { SiteIndustry, SiteStyle } from "@charisol/plexo-sdk/v2/compile";
import { BUSINESS_TYPES, parseBusinessType } from "@/lib/onboarding/businessType";

export const INDUSTRIES = ["restaurant", "beauty", "fitness", "health", "tech", "creative", "professional", "retail", "education", "nonprofit", "realestate", "events", "travel", "homeservices", "general"] as const satisfies readonly SiteIndustry[];
export const STYLES = ["bold", "elegant", "playful", "minimal", "warm", "corporate", "dark", "editorial"] as const satisfies readonly SiteStyle[];

export type Understood = { industry: SiteIndustry; style: SiteStyle };

export const MIN_ABOUT = 8;
export const MAX_ABOUT = 500;

export function buildUnderstandPrompt(about: string, goal: string | undefined): string {
  return `Someone is making a website${goal ? ` (type: ${goal})` : ""}. They described it like this:\n"${about.slice(0, MAX_ABOUT)}"\n\nWhat kind of business or purpose is it, and what visual feel would suit it?\nindustry must be one of: ${INDUSTRIES.join(", ")} (restaurant also covers bakeries, cafes and food; retail covers shops; nonprofit covers churches and charities; use general only if nothing fits).\nstyle must be one of: ${STYLES.join(", ")}.\nReply with ONLY JSON like {"industry":"restaurant","style":"warm"}.`;
}

/** Reads the model's reply defensively: only the allowed words, anything else is dropped. */
export function parseUnderstood(text: string): Understood | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const raw = JSON.parse(text.slice(a, b + 1)) as { industry?: unknown; style?: unknown };
    const industry = INDUSTRIES.find((i) => i === String(raw.industry ?? "").toLowerCase().trim());
    const style = STYLES.find((s) => s === String(raw.style ?? "").toLowerCase().trim());
    if (!industry || !style) return null;
    return { industry, style };
  } catch {
    return null;
  }
}

/** Asks which kind of business this is, from the fixed list the designs are sorted by. Works from the name alone when that is all there is. */
export function buildBusinessTypePrompt(name: string, about: string, goal: string | undefined): string {
  const list = BUSINESS_TYPES.map((t) => `${t.id} (${t.covers})`).join("\n");
  return `Someone is making a website${goal ? ` (type: ${goal})` : ""}.\nBusiness name: "${name.slice(0, 100)}"\nWhat they said about it: "${about.slice(0, MAX_ABOUT) || "(nothing)"}"\n\nWhich kind of business or purpose is it? Choose exactly one id:\n${list}\nIf it is genuinely unclear, answer "unknown". Do not guess from a single vague word.\nReply with ONLY JSON like {"type":"fitness"}.`;
}

/** Reads the reply defensively: only a known id counts. */
export function parseBusinessTypeReply(text: string): string | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return parseBusinessType(String((JSON.parse(text.slice(a, b + 1)) as { type?: unknown }).type ?? "").toLowerCase().trim()) ?? null;
  } catch {
    return null;
  }
}
