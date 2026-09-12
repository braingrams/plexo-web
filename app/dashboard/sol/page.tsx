import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { SolConversation } from "@/lib/db/solEntities";
import { SolChatView } from "./_components/SolChatView";

/**
 * /dashboard/sol — lands on the most-recently-active conversation that actually has a
 * message in it (SolConversation's primary index sort key embeds updatedAt, see
 * lib/db/solEntities.ts, so `order: "desc"` hands back the most-recent one first with no
 * extra sort needed — `limit: 3` gives a little headroom to skip past a stray empty one
 * without a second query), or a fresh empty-chat state (no conversation created yet — the
 * first message sent from it creates one, see SolChatView's ensureConversation).
 *
 * Deliberately does NOT just take conversations[0] unconditionally: a conversation with
 * `messageCount === 0` (abandoned before a first message was ever sent) is not something
 * to resume — landing here should only ever "continue where you left off" for a real
 * conversation, never re-open an empty one just because it happens to be the most recently
 * touched row.
 *
 * `?new=1` (set by ThreadSidebar's "New chat") skips this resume behavior entirely and
 * always renders the blank composer — otherwise, once any real conversation exists,
 * clicking "New chat" would just bounce straight back into it.
 */
export default async function SolIndexPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const { new: forceNew } = await searchParams;
  if (!forceNew) {
    const { data: conversations } = await SolConversation.query.primary({ userId: session.user.id }).go({ order: "desc", limit: 3 });
    const mostRecentWithMessages = conversations.find((c) => (c.messageCount ?? 0) > 0);
    if (mostRecentWithMessages) redirect(`/dashboard/sol/${mostRecentWithMessages.id}`);
  }

  const userName = session.user.name ?? session.user.email?.split("@")[0] ?? null;
  return <SolChatView conversation={null} initialMessages={[]} userName={userName} />;
}
