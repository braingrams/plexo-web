import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { SolConversation, SolMessage } from "@/lib/db/solEntities";

const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/v1/sol/conversations/:id/messages?limit=&cursor=&order=
 *
 * Paginated transcript fetch, via SolMessage.query.primary — the actual chat-turn POST
 * lives on SolChatFn (lambda/sol-chat/index.ts), not here; this route is read-only.
 * `cursor` is ElectroDB's own opaque pager token (`.go()`'s returned `cursor`, base64 of
 * the last evaluated key) — round-tripped verbatim by the client, not something this route
 * constructs or interprets itself. `order` defaults to "desc" (newest first, matching how
 * a chat UI loads a transcript backwards from "now" as the user scrolls up); pass
 * `order=asc` for chronological order instead.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: conversationId } = await context.params;

  // Ownership check — SolMessage's own key is scoped to conversationId only (no userId),
  // so without this a caller could read another account's transcript just by guessing a
  // conversation id (a UUID, so not realistically guessable, but this is a real
  // authorization boundary, not defense-in-depth against a hard-to-guess id).
  const { data: conversations } = await SolConversation.query.primary({ userId: resolved.userId }).go({ pages: "all" });
  const conversation = conversations.find((c) => c.id === conversationId);
  if (!conversation || conversation.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const cursor = searchParams.get("cursor") || undefined;
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  const { data: messages, cursor: nextCursor } = await SolMessage.query.primary({ conversationId }).go({ order, limit, cursor });

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      usage: m.usage ?? null,
      confirmationState: m.confirmationState ?? null,
      feedback: m.feedback ?? null,
      feedbackComment: m.feedbackComment ?? null,
      createdAt: m.createdAt,
    })),
    cursor: nextCursor ?? null,
  });
}
