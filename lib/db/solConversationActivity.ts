import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import { docClient } from "./client";
import { SolConversation, SolMessage } from "./solEntities";

// Closes a gap a prior SOL task deliberately left open: nothing updated
// SolConversation.lastMessageAt/messageCount/updatedAt when new messages were appended to
// a conversation, because `updatedAt` is embedded in that entity's own primary-index sort
// key (`sk = CONVO#${updatedAt}#${id}`, see solEntities.ts) and composite sort-key
// attributes can't be safely changed via ElectroDB's `.patch()`/`.update()`.
//
// This isn't a guess — confirmed by reading ElectroDB's own source
// (node_modules/electrodb/src/entity.js, `_updateExpressionBuilder`): it explicitly
// `skip`s the table's raw pk/sk fields when building an UpdateExpression, so a `.patch()`
// that sets `updatedAt` WOULD silently update the plain `updatedAt` attribute value on the
// item while leaving the physical `sk` (and thus the item's position in the
// "most-recently-updated first" query order primary() relies on) pointing at the OLD
// timestamp — a real, silent data-consistency bug, not just a theoretical one. There is no
// ElectroDB "recreate under a new key" primitive for this; the only correct fix is an
// explicit delete-old-item + put-new-item, wrapped in one DynamoDB transaction so it can
// never leave behind zero items (data loss) or two items (a duplicate) if it fails
// partway.
//
// messageCount/lastMessageAt are recomputed from the real SolMessage rows for this
// conversation (rather than incremented by a caller-supplied delta) so this function is
// self-correcting: even if it's ever skipped for a given turn (an error, a race — see
// below), the NEXT successful call re-derives the true count/last-activity time from the
// source of truth instead of compounding drift.
export async function bumpConversationActivity(userId: string, conversationId: string): Promise<void> {
  const { data: conversations } = await SolConversation.query.primary({ userId }).go({ pages: "all" });
  const existing = conversations.find((c) => c.id === conversationId);
  // Conversation may have been renamed/archived/deleted concurrently, or (defensively)
  // just not found — bookkeeping is best-effort, never worth failing an otherwise-
  // successful chat turn over.
  if (!existing) return;

  const { data: messages } = await SolMessage.query.primary({ conversationId }).go({ pages: "all" });
  const messageCount = messages.length;
  const lastMessageAt = messages[messages.length - 1]?.createdAt ?? new Date().toISOString();
  const updatedAt = new Date().toISOString();

  const deleteParams = SolConversation
    // Targets the item's exact current primary key. The `.where()` optimistic-lock
    // condition (same pattern as lib/db/ledgerOperations.ts's debitCredits) guards
    // against a genuinely concurrent bump for the SAME conversation (two turns
    // completing at once — unlikely in normal single-user chat usage, but not
    // impossible): if another call already moved this item to a new sk between our
    // read and this write, the condition fails, the whole transaction cancels, and we
    // just skip this update rather than risk creating a duplicate item. The failure is
    // swallowed below deliberately — losing one bookkeeping refresh is harmless (the
    // next successful turn re-derives the correct values from scratch, per this
    // function's own doc comment), unlike losing a message or a balance.
    .remove({ userId, updatedAt: existing.updatedAt, id: existing.id })
    .where((attr, op) => op.eq(attr.updatedAt, existing.updatedAt))
    .params();

  const putParams = SolConversation.create({
    id: existing.id,
    userId: existing.userId,
    organizationId: existing.organizationId,
    title: existing.title,
    modelTier: existing.modelTier,
    status: existing.status,
    lastMessageAt,
    messageCount,
    createdAt: existing.createdAt,
    updatedAt,
  }).params();

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Delete: deleteParams as any },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Put: putParams as any },
        ],
      }),
    );
  } catch (err) {
    const anyErr = err as { name?: string; cause?: { name?: string } };
    const isConditionFailure =
      anyErr?.name === "ConditionalCheckFailedException" ||
      anyErr?.name === "TransactionCanceledException" ||
      anyErr?.cause?.name === "ConditionalCheckFailedException";
    if (!isConditionFailure) throw err;
    // Lost a genuine concurrent race — see comment above. Not re-thrown.
  }
}
