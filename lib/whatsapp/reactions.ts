
// A reaction on a WhatsApp message is the owner's thumbs up or down on the answer above it.

import { ratingForReaction } from "@/lib/sol/ratingEmoji";

export { ratingForReaction };

export const FEEDBACK_FOLLOW_UP = "Sorry about that. What did you expect instead? Just reply and I'll learn from it.";
const FOLLOW_UP_MINUTES = 30;

/** Saves the rating (and the full question and answer for plexo-admin) on the latest answer. Returns the rated message's id, or null when there was none. */
export async function rateLatestAnswer(userId: string, conversationId: string, rating: "UP" | "DOWN"): Promise<string | null> {
  const { saveSolFeedback } = await import("@/lib/sol/feedback");
  return (await saveSolFeedback({ userId, conversationId, rating, source: "whatsapp" }))?.id ?? null;
}

/** The time until which their next message counts as "what I expected instead". */
export function followUpDeadline(now = Date.now()): string {
  return new Date(now + FOLLOW_UP_MINUTES * 60_000).toISOString();
}

/** Saves their reply as the note on a thumbs-down. */
export async function saveExpectation(userId: string, conversationId: string, messageId: string, comment: string): Promise<void> {
  const { saveSolFeedback } = await import("@/lib/sol/feedback");
  await saveSolFeedback({ userId, conversationId, messageId, rating: "DOWN", comment, source: "whatsapp" });
}
