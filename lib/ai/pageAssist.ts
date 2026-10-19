import { SOL_SYSTEM_PROMPT } from "@charisol/plexo-sdk/v2/compile";

import { friendlyProviderError } from "@/lib/ai/providerErrors";
import { callProvider, MAX_TOKENS } from "@/lib/ai/generate";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { checkCanAfford, solRouteForUser, tierFor } from "@/lib/ai/solEngine";
import { chargeUsage, estimateWorstCaseCost, holdCredits, releaseHold } from "@/lib/db/ledgerOperations";
import type { ConcreteTier } from "@/lib/ai/types";
import { randomUUID } from "node:crypto";

// SOL inside the visual editor, answering over one streamed response: a few warm sentences, then
// the same fenced section commands the editor already understands (SOL_SYSTEM_PROMPT). The editor
// applies each command the moment it has arrived, so the page changes while SOL is still writing.
// Plexo's own AI is paid from credits exactly like SOL chat (a hold while it runs, the real usage
// billed after); an own provider key is billed by the provider and never in credits.

export type AssistFrame =
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

export type AssistRefusal = { status: number; error: string };

/** The editor sends the whole site (sections in order, brand, catalog); a hand-written request can't pass this size. */
const MAX_REQUEST_CHARS = 400_000;
const MAX_QUESTION_CHARS = 4_000;
const MAX_HISTORY_TURNS = 8;
const HEARTBEAT_MS = 10_000;

/** What SOL is told on top of the editor's own guidance: this editor applies changes as they are written. */
export const PAGE_ASSIST_NOTES = `Where you are: you are inside the owner's visual editor, looking at the page they have open ("design" lists it; "asking about" is the element or section they selected, if any).
- Your changes are applied to the page the moment you write them and the owner can undo them in one click, so make each change small and focused, and say in your first sentence what you are about to change.
- Write the sentence first, then the changes block. Never write more than one block.
- "Refine", "improve" or "polish" means real, specific edits, not advice. Answer in plain words only when they asked a question.
- If the selected section was designed by hand and its content cannot be edited, say so kindly and offer to add a new section, restyle or move it instead.`;

export interface AssistInput {
  question: string;
  nodeType?: string;
  nodeName?: string;
  pageId?: string;
  design?: unknown;
  catalog?: unknown;
  history: Array<{ role: "you" | "sol"; text: string }>;
}

function clean(raw: unknown, max: number): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, max) : undefined;
}

export function parseAssistBody(body: unknown): { input: AssistInput } | AssistRefusal {
  const b = body as { question?: unknown; context?: Record<string, unknown>; history?: unknown } | null;
  const question = clean(b?.question, MAX_QUESTION_CHARS);
  if (!b || !question) return { status: 400, error: "Type what you'd like SOL to do first." };
  const context = b.context && typeof b.context === "object" ? b.context : {};
  const history = Array.isArray(b.history)
    ? b.history
        .filter((h): h is { role: "you" | "sol"; text: string } => !!h && (h.role === "you" || h.role === "sol") && typeof h.text === "string")
        .slice(-MAX_HISTORY_TURNS)
        .map((h) => ({ role: h.role, text: h.text.slice(0, 2_000) }))
    : [];
  const input: AssistInput = {
    question,
    nodeType: clean(context.nodeType, 60),
    nodeName: clean(context.nodeName, 120),
    pageId: clean(context.pageId, 120),
    design: context.design,
    catalog: context.catalog,
    history,
  };
  if (JSON.stringify([input.design, input.catalog]).length + question.length > MAX_REQUEST_CHARS) {
    return { status: 413, error: "This site is too big for SOL to read in one go. Try selecting just the part you want help with." };
  }
  return { input };
}

function userPromptFor(input: AssistInput): string {
  const about = input.nodeType ? `the selected ${input.nodeType}${input.nodeName ? ` ("${input.nodeName}")` : ""}` : "the whole page";
  const past = input.history.length ? `Earlier in this chat:\n${input.history.map((h) => `${h.role === "you" ? "Owner" : "SOL"}: ${h.text}`).join("\n")}\n\n` : "";
  return `${past}catalog:\n${JSON.stringify(input.catalog ?? null)}\n\ndesign:\n${JSON.stringify(input.design ?? null)}\n\nOpen page id: ${input.pageId ?? "(unknown)"}\nAsking about: ${about}\n\nOwner's request: ${input.question}`;
}

/**
 * Everything that can be refused is decided before the stream opens, so a refusal is a real status with a plain-English
 * message (no AI / not enough credits / a bad request). `run` then streams the answer as frames.
 */
export async function prepareAssist(
  userId: string,
  body: unknown,
): Promise<{ refused: AssistRefusal } | { run: (emit: (frame: AssistFrame) => void) => Promise<void> }> {
  const parsed = parseAssistBody(body);
  if ("error" in parsed) return { refused: parsed };
  const { input } = parsed;

  const resolved = await solRouteForUser(userId);
  if ("error" in resolved) return { refused: resolved };
  const { route, plan } = resolved;
  const tier: ConcreteTier = tierFor(route, plan, "MEDIUM");
  const userPrompt = userPromptFor(input);
  const systemPrompt = `${SOL_SYSTEM_PROMPT}\n\n${PAGE_ASSIST_NOTES}`;
  const approxInputChars = systemPrompt.length + userPrompt.length;
  const byPlexo = route.paidBy === "plexo";

  const holdId = `assist_${randomUUID()}`;
  if (byPlexo) {
    const refusal = await checkCanAfford(userId, route, tier, "page_assist", approxInputChars);
    if (refusal) return { refused: refusal };
    const ceiling = estimateWorstCaseCost(route.provider, tier, "page_assist", approxInputChars);
    const held = await holdCredits(userId, holdId, ceiling);
    if (!held.held) return { refused: { status: 402, error: "You don't have enough AI credits for this right now. Top up in Settings → Subscription, or add your own AI provider key in Settings → AI." } };
  }

  return {
    run: async (emit) => {
      const heartbeat = setInterval(() => emit({ type: "token", text: "" }), HEARTBEAT_MS);
      try {
        const result = await callProvider(
          route.provider,
          resolveModel(route.provider, tier),
          route.apiKey,
          systemPrompt,
          userPrompt,
          MAX_TOKENS.page_assist,
          (delta) => emit({ type: "token", text: delta }),
        );
        if (byPlexo) {
          // The answer already reached the owner; a billing hiccup must not turn it into an error.
          await chargeUsage(userId, { provider: route.provider, tier, mode: "page_assist", usage: result.usage, releaseHoldId: holdId }).catch(async (chargeErr) => {
            console.error("[page-assist] couldn't bill the answer:", chargeErr);
            await releaseHold(userId, holdId).catch(() => {});
          });
        }
        if (result.truncated) {
          emit({ type: "error", error: "SOL's answer was cut off because it got too long. Try asking for a smaller change." });
          return;
        }
        emit({ type: "done" });
      } catch (err) {
        console.error("[page-assist] failed:", err);
        if (byPlexo) await releaseHold(userId, holdId).catch(() => {});
        emit({ type: "error", error: `SOL couldn't answer that: ${friendlyProviderError(err)}` });
      } finally {
        clearInterval(heartbeat);
      }
    },
  };
}
