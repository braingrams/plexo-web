import { randomUUID } from "node:crypto";

import { generate } from "@/lib/ai/providers/bedrockClaude";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { SolMemoryFact } from "@/lib/db/solEntities";

// Automatic "SOL remembers this" extraction — the background half of the ChatGPT/
// Claude-style memory feature. The manual half (Settings > Memory, add/edit/delete a
// SolMemoryFact by hand) already exists and works fine (app/api/v1/sol/memories/**); this
// module is what notices a durable fact/preference surfacing naturally inside an ordinary
// chat turn and saves it without the user having to go type it in themselves.
//
// Two-stage cost control, same spirit as lib/ai/complexity.ts's classifyPromptComplexity:
// `looksMemoryWorthy` is a free, local, no-LLM-call heuristic that gates the (much more
// expensive, tokens-and-latency) `maybeExtractMemoryFact` call — the vast majority of chat
// turns ("ok", "thanks", a bare "delete this product" with no personal context) are
// obviously not memory-worthy and should never even reach Bedrock.

// One-off acks/confirmations — never worth an extraction call by themselves, regardless of
// how the rest of the heuristic would score them.
const TRIVIAL_EXCHANGES = new Set([
  "ok", "okay", "k", "kk", "yes", "yep", "yeah", "yup", "no", "nope", "nah",
  "sure", "sure thing", "thanks", "thank you", "thx", "ty", "np", "no problem",
  "got it", "sounds good", "perfect", "great", "cool", "nice", "done", "please",
]);

// First-person, durability-flavored language — "this is an ongoing fact/preference about
// me/us", not a one-off task instruction. Any hit here is a strong enough signal to skip
// straight to true.
const MEMORY_SIGNAL_PHRASES = [
  "i always", "i usually", "i typically", "i generally", "i normally",
  "i never", "i prefer", "i'd prefer", "i would prefer", "i like", "i love", "i hate",
  "i don't like", "i dont like", "i don't want", "i dont want",
  "from now on", "going forward", "in the future", "for future reference",
  "every time", "whenever i", "whenever you", "each time",
  "remember that", "remember this", "please remember", "keep in mind", "don't forget",
  "dont forget", "note that", "just so you know", "for context",
  "my business", "my company", "my brand", "my store", "my shop", "my website",
  "our business", "our company", "our brand", "our store",
  "we ship", "we sell", "we're based", "we are based", "i'm based", "i am based",
  "i run a", "i own a", "call me", "my name is", "my preference", "my style",
  "my tone", "my audience", "my customers",
];

// A bare imperative with no first-person framing at all ("delete the summer sale
// product", "publish the homepage") reads as a one-off task, not a durable fact — unless
// it's also carrying personal context (caught by MEMORY_SIGNAL_PHRASES or the pronoun
// check below), it's the clearest "skip" case besides trivial acks.
const BARE_COMMAND_PATTERN =
  /^(create|add|delete|remove|update|edit|publish|unpublish|refund|show|list|open|go to|goto|change|set|make|build|generate|write|draft|rename|move|duplicate|clone|archive|restore|enable|disable|turn on|turn off)\b/i;

const PERSONAL_PRONOUNS = new Set([
  "i", "im", "i'm", "ive", "i've", "id", "i'd", "my", "mine", "myself",
  "we", "were", "we're", "our", "ours", "us",
]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

/**
 * Cheap, local, no-LLM-call heuristic: does this exchange look like it revealed a durable
 * fact/preference, as opposed to a one-off task instruction? Deliberately errs toward
 * `true` for ambiguous cases — a false negative here just means a missed memory (low
 * cost), whereas a false positive only costs one cheap BASIC-tier classification call that
 * itself replies NONE (the real cost control is this heuristic existing at all, gating out
 * the obviously-not-memory-worthy majority of turns before they ever reach Bedrock).
 */
export function looksMemoryWorthy(userText: string, _assistantText: string): boolean {
  const trimmed = userText.trim();
  if (trimmed.length === 0) return false;

  const normalized = trimmed.toLowerCase().replace(/[.!?\s]+$/, "");
  if (TRIVIAL_EXCHANGES.has(normalized)) return false;

  if (MEMORY_SIGNAL_PHRASES.some((phrase) => normalized.includes(phrase))) return true;

  const tokenList = words(trimmed);
  if (tokenList.length < 4) return false; // too short to carry a durable statement

  const hasPersonalFraming = tokenList.some((word) => PERSONAL_PRONOUNS.has(word));
  if (!hasPersonalFraming && BARE_COMMAND_PATTERN.test(trimmed)) return false;

  // Ambiguous otherwise — err toward true, per this function's own doc comment.
  return true;
}

const MAX_ACTIVE_FACTS_PER_USER = 50;
const MAX_FACT_TEXT_LENGTH = 500; // matches SolMemoryFact.text's own validate() cap

const PREFERENCE_KEYWORDS = ["prefer", "always", "style", "tone", "like to", "favorite", "favourite", "avoid"];

function buildExtractionPrompt(userText: string, assistantText: string, existingFacts: string[]): string {
  const existingBlock =
    existingFacts.length > 0
      ? `\n\nFacts already saved about this user — reply NONE if the exchange below is already effectively captured by one of these, don't create a near-duplicate:\n${existingFacts
          .map((fact) => `- ${fact}`)
          .join("\n")}`
      : "";

  return `Here is one exchange from a conversation between a user and SOL, an AI agent that manages the user's website/store on Plexo.

User said: "${userText}"
SOL replied: "${assistantText}"${existingBlock}

Does this exchange reveal a durable fact or preference about the user worth remembering for future conversations (e.g. their business, their audience, a standing style/tone preference, a recurring constraint) — as opposed to a one-off task detail that only matters for this exchange? If yes, reply with ONLY the fact as one short sentence, phrased as a statement about the user (e.g. "Prefers a casual tone for blog posts."). If no, or if it's already captured above, reply with exactly NONE.`;
}

function classifyCategory(text: string): "PREFERENCE" | "FACT" {
  const normalized = text.toLowerCase();
  return PREFERENCE_KEYWORDS.some((keyword) => normalized.includes(keyword)) ? "PREFERENCE" : "FACT";
}

export interface MaybeExtractMemoryFactParams {
  userId: string;
  conversationId: string;
  userText: string;
  assistantText: string;
  /** Current facts' text, for dedup context (and, as a cheap proxy, the per-user cap check). */
  existingFacts: string[];
}

/**
 * Best-effort, fire-and-forget: notices when an ordinary chat turn revealed a durable
 * fact/preference and saves it as an LLM_EXTRACTED SolMemoryFact. Never throws — a failure
 * here (Bedrock error, Dynamo error) must never affect the chat turn that already
 * completed and was delivered to the user, so every failure path is caught and logged
 * internally instead of propagated.
 */
export async function maybeExtractMemoryFact(params: MaybeExtractMemoryFactParams): Promise<void> {
  const { userId, conversationId, userText, assistantText, existingFacts } = params;
  try {
    if (!looksMemoryWorthy(userText, assistantText)) return;

    // Simple count-and-skip cap enforcement (~50 active facts/user) — no LRU eviction,
    // an honest v1. `existingFacts` is already the caller's full current list, so this is
    // free (no extra query).
    if (existingFacts.length >= MAX_ACTIVE_FACTS_PER_USER) return;

    const model = resolveModel("bedrock_claude", "BASIC");
    const result = await generate({
      model,
      apiKey: "", // unused by the Bedrock provider (IAM-authenticated) — see bedrockClaude.ts
      systemPrompt:
        "You extract durable, long-term-memorable facts/preferences about a user from one conversation exchange. You are extremely conservative: task-specific details (\"delete this product\", \"the homepage headline\") are NOT durable facts. Reply with ONLY the extracted fact as one short sentence, or exactly NONE — no other text, no preamble, no quotes.",
      userPrompt: buildExtractionPrompt(userText, assistantText, existingFacts),
      maxTokens: 200,
    });

    const extracted = (result.text ?? "").trim();
    if (!extracted || extracted.toUpperCase() === "NONE") return;

    const text = extracted.slice(0, MAX_FACT_TEXT_LENGTH);

    await SolMemoryFact.create({
      id: randomUUID(),
      userId,
      text,
      category: classifyCategory(text),
      source: "LLM_EXTRACTED",
      sourceConversationId: conversationId,
    }).go();
  } catch (err) {
    console.error("maybeExtractMemoryFact: failed to extract/save memory fact:", err);
  }
}
