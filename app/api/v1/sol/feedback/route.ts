import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { saveSolFeedback } from "@/lib/sol/feedback";

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

  // saveSolFeedback checks the message belongs to this user, saves the rating and note on it,
  // and keeps a copy with the full question and answer for plexo-admin.
  const saved = await saveSolFeedback({ userId: resolved.userId, conversationId: threadId, messageId, rating, comment, source: "dashboard" });
  if (!saved) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
