import { SolConversation, SolConversationShare, SolMessage, SolShareLink } from "@/lib/db/solEntities";
import { Member } from "@/lib/db/coreEntities";
import { chunk } from "./concurrency";

// An app's builder chats (SolConversation.appId — one per person who opened the app editor)
// go when the app does: they're about an app that no longer exists, and left behind they sat
// in people's SOL lists bound to nothing (watchy, Bellaskincare and an old telly on staging).

/** Deletes every SOL chat bound to this app — its messages, any share link, and the chat —
 *  for the app's owner and everyone in its organization. Returns how many chats went. */
export async function deleteAppConversations(app: { id: string; userId?: string | null; organizationId: string }): Promise<number> {
  const { data: members } = await Member.query.primary({ organizationId: app.organizationId }).go({ pages: "all", attributes: ["userId"] });
  const people = new Set([...(app.userId ? [app.userId] : []), ...members.map((m) => m.userId)]);
  let removed = 0;
  for (const userId of people) {
    const { data: conversations } = await SolConversation.query.primary({ userId }).go({ pages: "all" });
    for (const convo of conversations.filter((c) => c.appId === app.id)) {
      await deleteConversation(convo);
      removed += 1;
    }
  }
  return removed;
}

async function deleteConversation(convo: { id: string; userId: string; updatedAt?: string }): Promise<void> {
  const { data: messages } = await SolMessage.query.primary({ conversationId: convo.id }).go({ pages: "all", attributes: ["conversationId", "createdAt", "id"] });
  for (const batch of chunk(messages, 25)) await SolMessage.delete(batch.map((m) => ({ conversationId: m.conversationId, createdAt: m.createdAt, id: m.id }))).go();
  const { data: share } = await SolConversationShare.get({ conversationId: convo.id }).go();
  if (share) {
    await SolShareLink.delete({ token: (share as { token: string }).token }).go().catch(() => undefined);
    await SolConversationShare.delete({ conversationId: convo.id }).go();
  }
  await SolConversation.delete({ userId: convo.userId, updatedAt: convo.updatedAt!, id: convo.id }).go();
}
