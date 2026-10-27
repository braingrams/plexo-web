import type { ContentBlock, ToolUseBlock } from "./types";

function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return (block as { type?: unknown }).type === "tool_use";
}

/** The tool call a paused turn is waiting on (SOL's question, or an action to confirm).
 *  It's the one marked awaiting, else the turn's LAST call — never just the first: SOL often
 *  reads files before asking, and taking the first call found that read, so the question
 *  box never appeared. */
export function pausingCall(blocks: ContentBlock[] | undefined): ToolUseBlock | undefined {
  const calls = (blocks ?? []).filter(isToolUse);
  return calls.find((b) => b.status === "awaiting_confirmation") ?? calls.at(-1);
}
