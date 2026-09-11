// Shared internal "document model" for exporting a SOL conversation to a downloadable
// file. One AST (DocumentModel below) is built once from a conversation's messages, then
// each format-specific renderer (renderHtml.ts/renderDocx.ts/renderPdf.ts) walks the same
// DocBlock[] — so a PDF/DOCX/HTML export of the same conversation can't drift apart the
// way three independent "walk the messages and produce output" implementations would.

export type ToolActionStatus = "success" | "error" | "cancelled";

export type DocBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "toolAction"; label: string; status: ToolActionStatus }
  | { kind: "codeBlock"; language?: string; code: string }
  | { kind: "imageRef"; url: string; alt?: string };

export interface DocumentModel {
  title: string;
  generatedAt: string;
  blocks: DocBlock[];
}

// `SolMessage.content` is stored as `any` by design (see lib/db/solEntities.ts — "a full
// LLM content-block array ... stored as-is") so this is deliberately a loose, permissive
// shape rather than a strict Anthropic SDK type. `confirmationState` mirrors
// SolMessage's own field (only ever set on an assistant message carrying a tool_use that
// required user confirmation).
export interface SolMessageLike {
  id?: string;
  role: "user" | "assistant" | "tool" | string;
  content: unknown;
  confirmationState?: string | null;
}

const DECLINED_TOOL_RESULT_TEXT = "The user declined to authorize this action.";

/** Normalizes a SolMessage's `content` (string | content-block array | single block |
 * anything else) into a content-block array we can walk uniformly. */
function normalizeContentBlocks(content: unknown): Record<string, unknown>[] {
  if (Array.isArray(content)) return content.filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object");
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (content && typeof content === "object") return [content as Record<string, unknown>];
  return [];
}

/** Best-effort JSON.parse for a tool_result's `content` (usually a JSON-stringified
 * string, see solAgent.ts's buildToolResultBlock) — used only to look for a readable
 * detail (a name/title) to enrich a toolAction label. Never throws. */
function safeParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** A block carries a URL-referenced image when it either has a top-level `url` (a plain
 * `{type:"image", url}` shape) or an Anthropic-style `source.url` (as opposed to an
 * inline base64 `source.data`, which has nothing we can link out to). */
function extractImageUrl(block: Record<string, unknown>): string | undefined {
  if (typeof block.url === "string" && block.url) return block.url;
  const source = block.source;
  if (source && typeof source === "object" && typeof (source as Record<string, unknown>).url === "string") {
    return (source as Record<string, unknown>).url as string;
  }
  return undefined;
}

/** Splits a text block on markdown-ish ``` fences into alternating paragraph/codeBlock
 * entries, so a raw fenced code block never lands verbatim inside a `paragraph`. */
function splitTextIntoBlocks(text: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  const fenceRe = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) blocks.push({ kind: "paragraph", text: before });

    const language = match[1] || undefined;
    const code = match[2].replace(/\n$/, "");
    blocks.push({ kind: "codeBlock", language, code });

    lastIndex = fenceRe.lastIndex;
  }

  const rest = text.slice(lastIndex).trim();
  if (rest) blocks.push({ kind: "paragraph", text: rest });

  return blocks;
}

function renderInlineContent(contentBlocks: Record<string, unknown>[]): DocBlock[] {
  const out: DocBlock[] = [];
  for (const block of contentBlocks) {
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      out.push(...splitTextIntoBlocks(block.text));
    } else if (block.type === "image") {
      const url = extractImageUrl(block);
      if (url) out.push({ kind: "imageRef", url, alt: typeof block.alt === "string" ? block.alt : undefined });
    }
    // Any other block type found inline (e.g. a stray tool_use/tool_result in a
    // user-authored message) has nothing readable to show and is silently skipped.
  }
  return out;
}

// Recognized leading verbs across this codebase's ~60+ MCP/SOL tool names (create_*,
// update_*, delete_*, get_*, list_*, design_*, publish_*, refund_*, moderate_*, etc. — see
// lib/mcp/mcpServer.ts, blogTools.ts, commerceTools.ts, lmsTools.ts). Not exhaustive by
// design (per the task: "doesn't need to be ... perfect for every one of the ~60+ tools")
// — an unrecognized prefix falls back to a neutral "ran" phrasing below.
const KNOWN_VERB_PREFIXES = [
  "delete", "remove", "create", "update", "set", "get", "list", "search",
  "publish", "unpublish", "duplicate", "clone", "design", "generate",
  "compile", "refund", "request", "send", "add", "enable", "disable",
  "reset", "moderate", "archive", "restore", "sync", "verify", "validate",
  "import", "export", "schedule", "assign", "unassign", "review",
  "submit", "approve", "reject", "cancel", "confirm", "connect",
  "disconnect", "invite", "revoke", "upload", "download", "apply",
  "mark", "link", "unlink", "merge", "rename", "move", "copy",
];

const IRREGULAR_PAST_TENSE: Record<string, string> = {
  get: "looked up",
  set: "set",
  send: "sent",
  reset: "reset",
  run: "ran",
  put: "put",
  cut: "cut",
  read: "read",
};

function toPastTense(infinitive: string): string {
  if (IRREGULAR_PAST_TENSE[infinitive]) return IRREGULAR_PAST_TENSE[infinitive];
  if (infinitive.endsWith("e")) return `${infinitive}d`;
  if (/[^aeiou]y$/.test(infinitive)) return `${infinitive.slice(0, -1)}ied`;
  return `${infinitive}ed`;
}

/** Maps a snake_case tool name to a readable {infinitive, past, noun} triple, e.g.
 * "delete_commerce_product" -> {infinitive: "delete", past: "deleted", noun: "commerce
 * product"}. Simple prefix-based humanization, not an exhaustive per-tool mapping. */
function humanizeToolName(name: string): { infinitive: string; past: string; noun: string } {
  const parts = name.split("_").filter(Boolean);
  const first = parts[0]?.toLowerCase();
  if (first && KNOWN_VERB_PREFIXES.includes(first) && parts.length > 1) {
    return { infinitive: first, past: toPastTense(first), noun: parts.slice(1).join(" ") };
  }
  return { infinitive: "run", past: "ran", noun: name.replace(/_/g, " ") };
}

const DETAIL_KEYS = [
  "title", "name", "productName", "pageTitle", "pageName", "discountCode", "code",
  "domain", "slug", "subject", "postTitle", "categoryName", "tagName", "authorName", "email",
];

/** Pulls a human-readable detail (a name/title/etc.) out of a tool's input args or its
 * result payload, to turn a generic "Sol updated the commerce product" into "Sol updated
 * the commerce product 'Spring Sale Tee'" when one is available. */
function pickDetail(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of DETAIL_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function buildToolActionLabel(toolName: string, input: unknown, status: ToolActionStatus, resultContent: unknown): string {
  const { infinitive, past, noun } = humanizeToolName(toolName);
  const detail = pickDetail(input) ?? pickDetail(safeParseJson(resultContent));
  const subject = detail ? `${noun} "${detail}"` : noun;

  if (status === "cancelled") return `Sol asked to ${infinitive} the ${subject}, but the action was cancelled.`;
  if (status === "error") return `Sol tried to ${infinitive} the ${subject}, but it failed.`;
  return `Sol ${past} the ${subject}.`;
}

interface PendingToolUse {
  name: string;
  input: unknown;
  confirmationState?: string | null;
}

/**
 * Walks a conversation's messages in order and produces a readable narrative
 * DocumentModel: a title heading, "You"/"Sol" sections with their text (fenced code
 * blocks pulled out into `codeBlock` entries), and a neutral one-line summary for every
 * resolved tool_use/tool_result pair.
 */
export function buildConversationDocument(conversation: { title?: string }, messages: SolMessageLike[]): DocumentModel {
  const title = conversation.title?.trim() || "SOL conversation";
  const blocks: DocBlock[] = [{ kind: "heading", level: 1, text: title }];

  // tool_use blocks (from an assistant message) are only resolved once the matching
  // tool_result (in a following "tool"-role message) is seen — tracked here by
  // tool_use id so the toolAction summary can carry the tool's name/args even though
  // the result itself only carries a tool_use_id.
  const pendingToolUses = new Map<string, PendingToolUse>();

  for (const message of messages) {
    const contentBlocks = normalizeContentBlocks(message.content);

    if (message.role === "user") {
      const userBlocks = renderInlineContent(contentBlocks);
      if (userBlocks.length > 0) {
        blocks.push({ kind: "heading", level: 3, text: "You" });
        blocks.push(...userBlocks);
      }
      continue;
    }

    if (message.role === "assistant") {
      let headingAdded = false;
      for (const block of contentBlocks) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          if (!headingAdded) {
            blocks.push({ kind: "heading", level: 3, text: "Sol" });
            headingAdded = true;
          }
          blocks.push(...splitTextIntoBlocks(block.text));
        } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
          pendingToolUses.set(block.id, { name: block.name, input: block.input, confirmationState: message.confirmationState });
        } else if (block.type === "image") {
          const url = extractImageUrl(block);
          if (url) blocks.push({ kind: "imageRef", url, alt: typeof block.alt === "string" ? block.alt : undefined });
        }
      }
      continue;
    }

    // Everything else (the "tool" role — our own bookkeeping distinction for a
    // tool_results message, see solAgent.ts's toHistoryEntry) carries tool_result
    // blocks answering an earlier tool_use.
    for (const block of contentBlocks) {
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;

      const pending = pendingToolUses.get(block.tool_use_id);
      pendingToolUses.delete(block.tool_use_id);

      const toolName = pending?.name ?? "unknown_tool";
      const isError = Boolean(block.is_error);
      const contentText = typeof block.content === "string" ? block.content : undefined;
      const status: ToolActionStatus =
        pending?.confirmationState === "DECLINED" || contentText === DECLINED_TOOL_RESULT_TEXT
          ? "cancelled"
          : isError
            ? "error"
            : "success";

      blocks.push({ kind: "toolAction", label: buildToolActionLabel(toolName, pending?.input, status, block.content), status });
    }
  }

  return { title, generatedAt: new Date().toISOString(), blocks };
}
