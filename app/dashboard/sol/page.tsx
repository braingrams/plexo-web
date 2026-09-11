import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { SolConversation } from "@/lib/db/solEntities";
import { SolChatView } from "./_components/SolChatView";

/**
 * /dashboard/sol — lands on the most-recently-active conversation (SolConversation's
 * primary index sort key embeds updatedAt, see lib/db/solEntities.ts, so `order: "desc"`
 * hands back the most-recent one first with no extra sort needed), or a fresh empty-chat
 * state (no conversation created yet — the first message sent from it creates one, see
 * SolChatView's ensureConversation).
 */
export default async function SolIndexPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const { data: conversations } = await SolConversation.query.primary({ userId: session.user.id }).go({ order: "desc", limit: 1 });
  const mostRecent = conversations[0];
  if (mostRecent) redirect(`/dashboard/sol/${mostRecent.id}`);

  return <SolChatView conversation={null} initialMessages={[]} />;
}
