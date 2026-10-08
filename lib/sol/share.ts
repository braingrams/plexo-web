import { randomBytes } from "node:crypto";

import { SolConversation, SolConversationShare, SolMessage, SolShareLink } from "@/lib/db/solEntities";
import { getSignedDownloadUrl } from "@/lib/storage";

// Read-only sharing of a SOL conversation (Share in the chat header → /share/sol/<token>).
// A share is a snapshot: the messages up to the moment it was shared. Sharing again moves
// the same link forward; "Stop sharing" removes it. What a viewer sees is deliberately
// narrower than the transcript: the conversation's words, its attachments, and which steps
// SOL took — never a tool's inputs or results, which can hold private data (customer
// details, order contents, a page's full source).

export interface ShareStatus {
  shared: boolean;
  url: string | null;
  /** When the shared snapshot was taken. */
  upTo: string | null;
}

/** Where a share link opens — the dashboard's own origin. */
export function shareUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/share/sol/${token}`;
}

async function ownedConversation(userId: string, organizationId: string, conversationId: string) {
  const { data } = await SolConversation.query.primary({ userId }).go({ pages: "all" });
  const conversation = data.find((c) => c.id === conversationId);
  return conversation && conversation.organizationId === organizationId ? conversation : null;
}

export async function shareStatus(userId: string, organizationId: string, conversationId: string): Promise<ShareStatus | null> {
  if (!(await ownedConversation(userId, organizationId, conversationId))) return null;
  const { data } = await SolConversationShare.get({ conversationId }).go();
  return data ? { shared: true, url: shareUrl(data.token), upTo: data.upTo } : { shared: false, url: null, upTo: null };
}

/** Shares the conversation as it is now (or moves an existing link up to now). */
export async function shareConversation(userId: string, organizationId: string, conversationId: string): Promise<ShareStatus | null> {
  if (!(await ownedConversation(userId, organizationId, conversationId))) return null;
  const { data: existing } = await SolConversationShare.get({ conversationId }).go();
  const token = existing?.token ?? randomBytes(18).toString("base64url");
  const upTo = new Date().toISOString();
  await SolShareLink.put({ token, conversationId, userId, upTo }).go();
  await SolConversationShare.put({ conversationId, userId, token, upTo }).go();
  return { shared: true, url: shareUrl(token), upTo };
}

/** Turns the link off — anyone who has it gets "no longer shared". */
export async function stopSharing(conversationId: string): Promise<void> {
  const { data: existing } = await SolConversationShare.get({ conversationId }).go();
  if (!existing) return;
  await SolShareLink.delete({ token: existing.token }).go();
  await SolConversationShare.delete({ conversationId }).go();
}

export async function stopSharingOwned(userId: string, organizationId: string, conversationId: string): Promise<boolean> {
  if (!(await ownedConversation(userId, organizationId, conversationId))) return false;
  await stopSharing(conversationId);
  return true;
}

// ---- What a viewer sees -------------------------------------------------------------

export type SharedBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; name: string; description: string | null }
  | { kind: "file"; name: string }
  | { kind: "step"; label: string; failed: boolean };

export interface SharedMessage {
  id: string;
  role: "user" | "assistant";
  blocks: SharedBlock[];
}

export interface SharedConversation {
  title: string;
  upTo: string;
  messages: SharedMessage[];
}

type RawBlock = { type?: string; text?: string; name?: string; id?: string; tool_use_id?: string; is_error?: boolean; filename?: string; description?: string; source?: { url?: string } };

const STEP_VERBS: Record<string, string> = {
  get: "Checked", list: "Looked up", find: "Looked up", search: "Searched", create: "Created", add: "Added", delete: "Deleted",
  remove: "Removed", update: "Updated", edit: "Updated", set: "Set", publish: "Published", unpublish: "Unpublished",
  duplicate: "Duplicated", rename: "Renamed", send: "Sent", generate: "Generated", upload: "Uploaded", use: "Added",
};

function stepLabel(name: string): string {
  if (name === "ask_user_question") return "Asked a question";
  const [verb, ...rest] = name.split("_").filter(Boolean);
  const done = STEP_VERBS[verb?.toLowerCase() ?? ""];
  return done ? `${done} ${rest.join(" ")}`.trim() : name.replace(/_/g, " ");
}

function fileName(block: RawBlock): string {
  if (block.filename) return block.filename;
  const last = decodeURIComponent((block.source?.url ?? "").split("/").pop() || "");
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "") || "Attachment";
}

/** The messages a share shows (up to its snapshot), and which tool calls failed. */
async function sharedRows(conversationId: string, upTo: string) {
  const { data } = await SolMessage.query.primary({ conversationId }).go({ pages: "all" });
  return data.filter((m) => m.createdAt <= upTo).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function loadSharedConversation(token: string): Promise<SharedConversation | null> {
  const { data: link } = await SolShareLink.get({ token }).go();
  if (!link) return null;
  const { data: conversations } = await SolConversation.query.primary({ userId: link.userId }).go({ pages: "all" });
  const conversation = conversations.find((c) => c.id === link.conversationId);
  if (!conversation) return null;
  const rows = await sharedRows(link.conversationId, link.upTo);

  const failed = new Set<string>();
  for (const row of rows) {
    for (const block of (Array.isArray(row.content) ? row.content : []) as RawBlock[]) {
      if (block.type === "tool_result" && block.is_error && block.tool_use_id) failed.add(block.tool_use_id);
    }
  }

  const messages: SharedMessage[] = [];
  for (const row of rows) {
    if (row.role === "tool") continue; // tool results: never shown
    const blocks: SharedBlock[] = [];
    for (const block of (Array.isArray(row.content) ? row.content : []) as RawBlock[]) {
      if (block.type === "text" && block.text?.trim()) blocks.push({ kind: "text", text: block.text });
      else if (block.type === "image" && block.source?.url) {
        blocks.push({ kind: "image", url: `/api/v1/sol/shared/${token}/attachment?url=${encodeURIComponent(block.source.url)}`, name: fileName(block), description: block.description ?? null });
      } else if (block.type === "document") blocks.push({ kind: "file", name: fileName(block) });
      else if (block.type === "tool_use" && block.name) blocks.push({ kind: "step", label: stepLabel(block.name), failed: failed.has(block.id ?? "") });
    }
    if (blocks.length > 0) messages.push({ id: row.id, role: row.role === "assistant" ? "assistant" : "user", blocks });
  }
  return { title: conversation.title || "SOL conversation", upTo: link.upTo, messages };
}

/** A short-lived link to an image in a shared conversation — only one that's actually in it. */
export async function sharedAttachmentLink(token: string, storedUrl: string): Promise<string | null> {
  const { data: link } = await SolShareLink.get({ token }).go();
  if (!link) return null;
  const rows = await sharedRows(link.conversationId, link.upTo);
  const inShare = rows.some((row) =>
    (Array.isArray(row.content) ? (row.content as RawBlock[]) : []).some((b) => b.type === "image" && b.source?.url === storedUrl),
  );
  return inShare ? getSignedDownloadUrl(storedUrl, 10 * 60) : null;
}
