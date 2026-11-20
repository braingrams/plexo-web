import { callProvider } from "@/lib/ai/generate";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { chargeFor, checkCanAfford, solRouteForUser, tierFor } from "@/lib/ai/solEngine";
import type { GenerateOutcome } from "@/lib/ai/types";
import { normalizeSectionTypeInput, type SectionTypeInput } from "./model";

// "Describe it and SOL drafts the design": the owner says what they're creating in their own words ("a menu with dish names,
// prices and photos"); SOL proposes the fields and the look. The draft goes through the same checks as a hand-made section,
// and the owner sees it in the preview before anything is saved.

const SYSTEM = `You design small reusable website sections for non-technical site owners. Reply with ONLY a JSON object, no markdown fences, no prose:
{ "fields": [...], "html": "...", "defaults": {...} }

fields: what the owner fills in. Each is { "label": "Plain words, e.g. Dish name", "type": one of "text","longtext","richtext","image","link","button","icon","toggle","color","select","list", "hint"?: "one short helping sentence", "placeholder"?: "e.g. Jollof rice" }.
- Use "richtext" for descriptions that may need bold, links or lists; "image" for pictures; "button" for a text + link button.
- "select" needs "options": ["A","B"]. "list" is a repeating group (one row per dish, person, testimonial...) and needs "item": [fields inside one row — no nested lists], "itemName": "dish", "min": 1, "limit": 24.
- Start with a "Heading" text field when it makes sense. Keep it to what the section really needs (usually 2 to 6 fields).

html: the section's design in plain HTML, using {{field_key}} where a value goes. A field's key is its label in lowercase with underscores ("Dish name" -> dish_name). Wrap the repeating part in {{#list_key}}...{{/list_key}}; inside it {{@number}} is the row number. Wrap optional parts in {{#key}}...{{/key}} so empty fields leave no gap. Buttons use {{button_key.label}} and {{button_key.href}}. Pictures: <img src="{{photo}}" alt="{{title}}">. Formatted-text fields are written with {{key}} too, placed inside a <div>, never a <p>.
Style with inline style attributes only, using these variables so it matches the site's brand: colours {{tone.heading}} {{tone.body}} {{tone.muted}} {{tone.accent}} {{tone.line}} {{tone.card}}; spacing var(--semantic-space-xs|sm|md|lg|xl); radius var(--radius-lg) var(--radius-xl); sizes var(--font-size-sm|lg|xl|3xl); heading font var(--font-family-heading). Put text-align:{{align}} on the outer element. Make it responsive with CSS grid like grid-template-columns:repeat(auto-fit,minmax(15rem,1fr)). No scripts, no <style> tags, no external links.

defaults: believable starting content for every field so the section looks finished the moment it is added — { "field_key": "value", "list_key": [{...}, {...}, {...}] } (3 rows for lists; leave pictures as "" ; formatted text as simple HTML like "<p>…</p>").`;

const clean = (raw: string): string => {
  let t = raw.trim();
  if (t.startsWith("```")) t = t.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
  return t;
};

export type DraftResult = { value: SectionTypeInput } | { error: string; status: number };

export async function draftSectionType(userId: string, name: string, description: string): Promise<DraftResult> {
  const solRoute = await solRouteForUser(userId);
  if ("error" in solRoute) return { error: solRoute.error, status: solRoute.status };
  const tier = tierFor(solRoute.route, solRoute.plan, "MEDIUM");
  const prompt = `Section name: ${name || "(not named yet)"}\nWhat the owner wants: ${description.slice(0, 1200)}`;
  const cannot = await checkCanAfford(userId, solRoute.route, tier, "design_section_type", prompt.length + SYSTEM.length);
  if (cannot) return { error: cannot.error, status: cannot.status };

  const model = resolveModel(solRoute.route.provider, tier);
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let usage: GenerateOutcome["usage"] = { inputTokens: 0, outputTokens: 0 };
    try {
      const out = await callProvider(solRoute.route.provider, model, solRoute.route.apiKey, SYSTEM, problem ? `${prompt}\n\nYour last draft had a problem: ${problem}\nFix it and answer again with the whole JSON.` : prompt, 6000);
      usage = { inputTokens: out.usage?.inputTokens ?? 0, outputTokens: out.usage?.outputTokens ?? 0 };
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(clean(out.text)) as Record<string, unknown>;
      } catch {
        problem = "it wasn't valid JSON";
        continue;
      }
      const input = normalizeSectionTypeInput({ name: name || "My section", description: undefined, fields: parsed.fields, html: parsed.html, defaults: parsed.defaults ?? undefined });
      if ("error" in input) {
        problem = input.error;
        continue;
      }
      return { value: input.value };
    } catch (err) {
      console.error("[custom-sections] draft failed", err);
      return { error: "SOL couldn't draft that just now. Pick one of the ready-made looks instead, or try again in a moment.", status: 502 };
    } finally {
      await chargeFor(userId, solRoute.route, tier, "design_section_type", usage).catch(() => undefined);
    }
  }
  return { error: "SOL's first idea didn't work out. Try describing it a little differently, or pick one of the ready-made looks.", status: 422 };
}
