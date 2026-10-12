// Keeps a long SOL turn affordable. Every model call replays the whole conversation, so a
// build that reads files, writes pages and takes screenshots for 100 steps re-sends the same
// old file contents and page code on every step (a measured 217-message app build cost ~6.4M
// input tokens, ~70k per call by the end). Old tool work is the bulk of that and is rarely
// needed again — the files are saved in the app and the app's file list is in the prompt every
// turn — so older rounds are replaced with short stubs. The person's own messages, SOL's
// words and every attached file are never touched.
//
// The cut moves in steps, not every round: the replayed prefix then stays byte-identical for
// several calls in a row, which is what lets prompt caching (providers/shared.ts) read it
// at a fraction of the price instead of rewriting it each time.

type Entry = { role: "user" | "assistant"; content: any };

/** The newest tool rounds kept in full. */
export const KEEP_RECENT_ROUNDS = 6;
/** How far the cut advances at a time (keeps the cached prefix stable between jumps). */
export const TRIM_STEP_ROUNDS = 6;
const LONG_TEXT = 500;
const KEEP_HEAD = 160;

const isToolRound = (e: Entry): boolean => e.role === "assistant" && Array.isArray(e.content) && e.content.some((b: any) => b?.type === "tool_use");

/** Shortens long strings anywhere in a tool call's input (file bodies, page HTML) — keeps its shape. */
function shrinkInput(value: unknown): unknown {
  if (typeof value === "string") return value.length > LONG_TEXT ? `${value.slice(0, KEEP_HEAD)}… [${value.length - KEEP_HEAD} more characters left out to save space — the work itself is saved]` : value;
  if (Array.isArray(value)) return value.map(shrinkInput);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrinkInput(v)]));
  return value;
}

function resultLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) return content.reduce((n, b: any) => n + (b?.type === "text" ? String(b.text ?? "").length : b?.type === "image" ? 2000 : JSON.stringify(b ?? "").length), 0);
  return JSON.stringify(content ?? null).length;
}

function stubResult(block: any): any {
  if (resultLength(block.content) <= LONG_TEXT) return block;
  const head = (typeof block.content === "string" ? block.content : (Array.isArray(block.content) ? block.content.find((b: any) => b?.type === "text")?.text : "") ?? "").toString().slice(0, KEEP_HEAD).replace(/\s+/g, " ");
  return {
    ...block,
    content: `[Earlier tool result left out to save space${head ? ` — it began: ${head}` : ""}. Run the tool again if you need it.]`,
  };
}

export function trimOldToolWork(history: Entry[]): Entry[] {
  const rounds = history.map((e, i) => (isToolRound(e) ? i : -1)).filter((i) => i >= 0);
  const cut = Math.floor(Math.max(0, rounds.length - KEEP_RECENT_ROUNDS) / TRIM_STEP_ROUNDS) * TRIM_STEP_ROUNDS;
  if (cut <= 0) return history;

  const oldRounds = new Set(rounds.slice(0, cut));
  const oldToolUseIds = new Set<string>();
  const out = history.map((entry, i) => {
    if (oldRounds.has(i)) {
      return {
        ...entry,
        content: entry.content.map((b: any) => {
          if (b?.type !== "tool_use") return b;
          oldToolUseIds.add(b.id);
          return { ...b, input: shrinkInput(b.input) };
        }),
      };
    }
    return entry;
  });
  return out.map((entry, i) => {
    // The results of those calls sit in the very next message.
    if (entry.role !== "user" || !Array.isArray(entry.content) || !oldRounds.has(i - 1)) return entry;
    return { ...entry, content: entry.content.map((b: any) => (b?.type === "tool_result" && oldToolUseIds.has(b.tool_use_id) ? stubResult(b) : b)) };
  });
}
