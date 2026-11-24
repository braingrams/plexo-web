import { ASK_USER_QUESTION_TOOL_NAME, type ContentBlock, type SolMessage } from "../../sol/_components/types";

/**
 * When SOL has just finished a piece of work, ask the owner how it went.
 * A finished piece of work is the last answer, after the owner's last message, that used
 * at least one real tool (building, editing, publishing, checking numbers), is not waiting
 * on them (no question or confirmation pending) and has not been rated yet. Plain chat
 * replies don't count, so the prompt stays rare.
 */
export function messageToRate(messages: SolMessage[], opts: { streaming: boolean; waiting: boolean }): SolMessage | null {
  if (opts.streaming || opts.waiting) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || last.pending || last.feedback) return null;
  const hasText = last.content.some((b) => (b as { type?: string; text?: string }).type === "text" && Boolean((b as { text?: string }).text?.trim()));
  if (!hasText) return null;

  let start = messages.length - 1;
  while (start > 0 && messages[start - 1].role !== "user") start--;
  const turn = messages.slice(start);
  const blocks: ContentBlock[] = turn.flatMap((m) => m.content);
  const awaiting = blocks.some((b) => (b as { status?: string }).status === "awaiting_confirmation");
  const usedTool = blocks.some((b) => (b as { type?: string; name?: string }).type === "tool_use" && (b as { name?: string }).name !== ASK_USER_QUESTION_TOOL_NAME);
  const rated = turn.some((m) => m.feedback);
  return usedTool && !awaiting && !rated ? last : null;
}

const key = (conversationId: string) => `sol-rate-prompted:${conversationId}`;

/** The prompt shows once per conversation (remembered in this browser when possible). */
export function alreadyPrompted(conversationId: string): boolean {
  try {
    return localStorage.getItem(key(conversationId)) === "1";
  } catch {
    return false;
  }
}

export function rememberPrompted(conversationId: string): void {
  try {
    localStorage.setItem(key(conversationId), "1");
  } catch {
    // The prompt may show again on the next visit; harmless.
  }
}
