import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { SolMessage } from "@/lib/db/solEntities";
import { recordSolFeedback } from "@/lib/solAnalytics";

/**
 * POST /api/v1/sol/feedback
 *
 * Body: `{messageId, threadId, rating: "UP"|"DOWN", comment?, modelTier?, toolCallsInvolved?}`
 * (`threadId` is the conversation id — named to match this route's own contract as given,
 * distinct from SolMessage/SolConversation's own `conversationId` field name).
 *
 * Persists thumbs up/down feedback (plus an optional comment) directly onto the rated
 * SolMessage row (`feedback`/`feedbackComment`, added to that entity in solEntities.ts for
 * this route). `modelTier`/`toolCallsInvolved` are accepted and validated but NOT written
 * anywhere new: they aren't attributes of any existing SOL entity, and adding a dedicated
 * analytics table/shape for them is exactly the "separate admin-analytics rollup" task this
 * route is explicitly scoped OUT of (per this task's own instructions) — inventing one here
 * would be guessing at a schema a different task owns. `modelTier` is already recoverable
 * later from the parent SolConversation, and `toolCallsInvolved` from the message's own
 * `content` blocks, so nothing is actually lost by not duplicating them now.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    messageId?: string;
    threadId?: string;
    rating?: string;
    comment?: string;
    modelTier?: string;
    toolCallsInvolved?: string[];
  };

  const { messageId, threadId, rating, comment } = body;
  if (!messageId || !threadId) {
    return NextResponse.json({ error: "`messageId` and `threadId` are required." }, { status: 400 });
  }
  if (rating !== "UP" && rating !== "DOWN") {
    return NextResponse.json({ error: '`rating` must be "UP" or "DOWN".' }, { status: 400 });
  }
  if (comment !== undefined && comment.length > 2000) {
    return NextResponse.json({ error: "`comment` must be 2000 characters or fewer." }, { status: 400 });
  }

  // SolMessage's primary key embeds createdAt (see solEntities.ts) — no by-id index, so
  // this finds the row the same "scoped list, find by id" way every other by-id SOL lookup
  // in this task does. The conversation-scoped query itself is already the ownership
  // boundary's first half; message.userId (denormalized on every SolMessage row
  // specifically for checks like this, per that attribute's own doc comment) is the second.
  const { data: messages } = await SolMessage.query.primary({ conversationId: threadId }).go({ pages: "all" });
  const message = messages.find((m) => m.id === messageId);
  if (!message || message.userId !== resolved.userId) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  await SolMessage.patch({ conversationId: threadId, createdAt: message.createdAt, id: message.id })
    .set({ feedback: rating, feedbackComment: comment?.trim() || undefined })
    .go();

  // lib/solAnalytics.ts's recordSolUsageEvent (called from lambda/sol-chat/index.ts once a
  // turn completes) deliberately pins its SolUsageEvent row's {id, createdAt} to this same
  // final assistant SolMessage's own {id, createdAt} — see that function's own comment —
  // specifically so this patch can target the matching analytics row with no extra lookup.
  // Fire-and-forget per lib/solAnalytics.ts's own documented convention: a failed/missing
  // analytics row (e.g. feedback on a message from before this wiring existed) must never
  // fail the user-visible feedback submission itself, which already succeeded above.
  void recordSolFeedback(message.id, threadId, message.createdAt, rating).catch((err) =>
    console.error("Failed to record SOL feedback analytics:", err),
  );

  return NextResponse.json({ success: true });
}
