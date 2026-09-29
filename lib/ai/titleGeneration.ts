import { generate } from "@/lib/ai/providers/bedrockClaude";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { setConversationTitleIfUnset } from "@/lib/db/solConversationActivity";

// ChatGPT/Claude.ai-style auto-titling: a conversation that's still showing "New
// conversation" in the sidebar after its first real exchange reads as broken, not just
// unfinished (see solChatHandler.ts's settleTurn, which gates this to fire only on a
// conversation's first completed turn — every later turn already has a title and this is
// a no-op). Deliberately always attempted on that first turn, unlike
// memoryExtraction.ts's looksMemoryWorthy heuristic gate: a title isn't optional the way a
// memory fact is, every conversation needs exactly one, so there's no "obviously not worth
// it" case to filter out cheaply — the cost here is one short, cheap BASIC-tier call, once
// per conversation, not once per turn.

const MAX_TITLE_LENGTH = 60;

function sanitizeTitle(raw: string): string | null {
  // Strip a wrapping quote pair a model sometimes adds despite the prompt's instruction
  // not to, and collapse any stray newlines the model might still produce.
  const cleaned = raw
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_TITLE_LENGTH ? `${cleaned.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : cleaned;
}

function buildTitlePrompt(userText: string, assistantText: string): string {
  // The assistant's reply is optional context only, when there is one (e.g. distinguishing
  // "publish my homepage" from a broader multi-step project it kicked off) — the title
  // should describe what the USER is trying to do, not summarize what SOL said back. Often
  // there's no reply text at all to include yet: this is now started the instant the
  // user's own message is known (see solChatHandler.ts), before the turn even runs, so it
  // can still produce a title even when that turn immediately pauses on a confirmation or
  // an ask_user_question call rather than replying with text.
  const solLine = assistantText.trim() ? `\nSOL: "${assistantText.slice(0, 500)}"` : "";
  return `Conversation so far:
User: "${userText.slice(0, 1000)}"${solLine}

Write a short title for this conversation, the way ChatGPT/Claude.ai title a new chat — 3 to 6 words, plain text, no quotes, no trailing period, no emoji. Describe what the user is trying to do.`;
}

export interface MaybeGenerateConversationTitleParams {
  userId: string;
  conversationId: string;
  userText: string;
  assistantText: string;
}

/**
 * Never throws — a failure here (Bedrock error, Dynamo error, a blank/unusable model
 * reply) must never surface anywhere near the chat turn that already completed and was
 * delivered to the user, so every failure path is caught and logged internally instead of
 * propagated; the caller always gets a clean `null` back in that case, never an
 * exception. setConversationTitleIfUnset's own "don't clobber an existing title" check is
 * the real race guard (a user could rename the conversation manually in the moment between
 * the turn completing and this call landing).
 *
 * Returns the title it actually saved (or null on any failure/skip) — solChatHandler.ts
 * awaits this (rather than firing it and moving on the way maybeExtractMemoryFact does)
 * specifically so it can hand the result back to the client as a `title_generated` stream
 * frame before the turn's response closes, instead of the title only ever showing up the
 * next time something happens to refetch the conversation list. The extra latency this
 * adds to the very first turn of a new conversation is small (a ~30-token completion) and
 * one-time only — every later turn skips this (see `needsTitle`) entirely.
 */
export async function maybeGenerateConversationTitle(params: MaybeGenerateConversationTitleParams): Promise<string | null> {
  const { userId, conversationId, userText, assistantText } = params;
  try {
    if (!userText.trim()) return null;

    const model = resolveModel("bedrock_claude", "BASIC");
    const result = await generate({
      model,
      apiKey: "", // unused by the Bedrock provider (IAM-authenticated) — see bedrockClaude.ts
      systemPrompt:
        "You write short conversation titles, the way ChatGPT/Claude.ai title a new chat. Reply with ONLY the title — no preamble, no quotes, no trailing punctuation.",
      userPrompt: buildTitlePrompt(userText, assistantText),
      maxTokens: 30,
    });

    const title = sanitizeTitle(result.text ?? "");
    if (!title) return null;

    await setConversationTitleIfUnset(userId, conversationId, title);
    return title;
  } catch (err) {
    console.error("maybeGenerateConversationTitle: failed to generate/save title:", err);
    return null;
  }
}
