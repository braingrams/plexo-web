import { SolMessage } from "@/lib/db/solEntities";
import { SolFeedback } from "@/lib/db/opsEntities";
import { redact } from "@/lib/privacy/redact";

// Saving a thumbs up or down on a SOL answer, from the dashboard or a WhatsApp reaction.
// The rating and note go on the message itself; a copy with the full question and answer
// goes to SolFeedback so plexo-admin can read the whole exchange in one place.

const MAX_TEXT = 8000;

type Block = { type?: string; text?: string; name?: string };

/** The plain text of a stored message (its text blocks only). */
export function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Block[]).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n").trim();
}

function toolsOfContent(content: unknown): string[] {
  return Array.isArray(content) ? [...new Set((content as Block[]).filter((b) => b?.type === "tool_use" && b.name).map((b) => b.name as string))] : [];
}

type Row = { id: string; role: string; userId: string; createdAt: string; content: unknown };

export type SaveFeedbackInput = {
  userId: string;
  conversationId: string;
  rating: "UP" | "DOWN";
  /** The answer being rated; the latest answer in the conversation when left out (WhatsApp reactions). */
  messageId?: string;
  comment?: string;
  source: "dashboard" | "whatsapp";
};

/** Returns the rated message's id and time, or null when there is nothing of theirs to rate. */
export async function saveSolFeedback(input: SaveFeedbackInput): Promise<{ id: string; createdAt: string } | null> {
  const { data } = await SolMessage.query.primary({ conversationId: input.conversationId }).go({ pages: "all" });
  const rows = (data as Row[]).filter((m) => m.userId === input.userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const target = input.messageId ? rows.find((m) => m.id === input.messageId) : [...rows].reverse().find((m) => m.role === "assistant");
  if (!target) return null;

  const comment = input.comment?.trim().slice(0, 2000) || undefined;
  await SolMessage.patch({ conversationId: input.conversationId, createdAt: target.createdAt, id: target.id })
    .set({ feedback: input.rating, ...(comment ? { feedbackComment: comment } : {}) })
    .go();

  // The question is the last thing the owner said before this answer; the answer is the
  // text of every assistant turn since then (SOL often speaks between tool calls).
  const before = rows.filter((m) => m.createdAt <= target.createdAt);
  const lastUser = [...before].reverse().find((m) => m.role === "user" && textOfContent(m.content));
  const turn = before.filter((m) => m.role === "assistant" && (!lastUser || m.createdAt > lastUser.createdAt));
  const answer = turn.map((m) => textOfContent(m.content)).filter(Boolean).join("\n\n");
  const tools = [...new Set(turn.flatMap((m) => toolsOfContent(m.content)))];

  const clip = (t: string) => redact(t).slice(0, MAX_TEXT);
  try {
    await SolFeedback.put({
      id: target.id,
      conversationId: input.conversationId,
      userId: input.userId,
      rating: input.rating,
      comment,
      question: lastUser ? clip(textOfContent(lastUser.content)) : undefined,
      answer: answer ? clip(answer) : undefined,
      tools: tools.length ? tools.join(", ") : undefined,
      source: input.source,
    }).go();
  } catch (err) {
    // The rating itself is saved above; the admin copy failing must not fail it.
    console.error("Failed to save SOL feedback copy:", err);
  }

  const { recordSolFeedback } = await import("@/lib/solAnalytics");
  void recordSolFeedback(target.id, input.conversationId, target.createdAt, input.rating).catch(() => undefined);
  return { id: target.id, createdAt: target.createdAt };
}
