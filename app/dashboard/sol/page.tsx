import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { SolConversation } from "@/lib/db/solEntities";
import { SolChatView } from "./_components/SolChatView";
import { SOL_LAST_CONVERSATION_COOKIE } from "./_components/types";

/**
 * /dashboard/sol — resumes the conversation THIS BROWSER SESSION was last actually in
 * (SolChatView writes SOL_LAST_CONVERSATION_COOKIE, a session cookie, whenever a real
 * conversation becomes active), or a fresh empty-chat state otherwise — a genuinely new
 * session (the browser was closed, a different browser/device, cookies cleared) always
 * starts blank rather than silently resurfacing however-old a conversation happened to be
 * most recently touched. The first message sent from the blank state creates a new
 * conversation (see SolChatView's ensureConversation).
 *
 * Deliberately validates the remembered id against a real, non-empty conversation rather
 * than trusting the cookie blindly — it can point at something deleted since, or (same
 * reasoning the old "most recent" logic used) a conversation abandoned before a first
 * message was ever sent, which isn't something to resume either.
 *
 * `?new=1` (set by ThreadSidebar's "New chat") skips this resume behavior entirely and
 * always renders the blank composer — otherwise, once a remembered conversation exists,
 * clicking "New chat" would just bounce straight back into it.
 */
export default async function SolIndexPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const { new: forceNew } = await searchParams;
  if (!forceNew) {
    const cookieStore = await cookies();
    const lastConversationId = cookieStore.get(SOL_LAST_CONVERSATION_COOKIE)?.value;
    if (lastConversationId) {
      const { data: conversations } = await SolConversation.query.primary({ userId: session.user.id }).go({ pages: "all" });
      const remembered = conversations.find((c) => c.id === lastConversationId && (c.messageCount ?? 0) > 0);
      if (remembered) redirect(`/dashboard/sol/${remembered.id}`);
    }
  }

  const userName = session.user.name ?? session.user.email?.split("@")[0] ?? null;
  return <SolChatView conversation={null} initialMessages={[]} userName={userName} />;
}
