import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { SolConversation, SolMessage } from "@/lib/db/solEntities";
import { SolChatView } from "../_components/SolChatView";
import type { ConversationSummary, SolMessage as SolMessageShape } from "../_components/types";

const MESSAGE_PAGE_SIZE = 40;

export default async function SolConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");

  const { conversationId } = await params;

  // SolConversation's only index is scoped to userId with updatedAt embedded in the sort
  // key (see lib/db/solEntities.ts) — no by-id GSI, so this is the same userId-scoped
  // scan-and-filter every other by-id SOL lookup in this task uses (identical to
  // app/api/v1/sol/conversations/[id]/route.ts's own loadOwnedConversation).
  const { data: conversations } = await SolConversation.query.primary({ userId: session.user.id }).go({ pages: "all" });
  const record = conversations.find((c) => c.id === conversationId);
  if (!record || record.organizationId !== orgResolution.organizationId) {
    notFound();
  }

  const conversation: ConversationSummary = {
    id: record.id,
    title: record.title ?? null,
    modelTier: record.modelTier ?? "BASIC",
    status: record.status ?? "ACTIVE",
    lastMessageAt: record.lastMessageAt ?? null,
    messageCount: record.messageCount ?? 0,
    createdAt: record.createdAt ?? new Date().toISOString(),
    updatedAt: record.updatedAt ?? new Date().toISOString(),
  };

  // First page for fast paint, newest-first per the transcript route's own default, then
  // reversed to chronological order for display — SolChatView appends new turns to the end.
  const { data: recentMessages } = await SolMessage.query.primary({ conversationId }).go({ order: "desc", limit: MESSAGE_PAGE_SIZE });
  const initialMessages: SolMessageShape[] = recentMessages
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      usage: m.usage ?? null,
      confirmationState: m.confirmationState ?? null,
      feedback: m.feedback ?? null,
      feedbackComment: m.feedbackComment ?? null,
      createdAt: m.createdAt,
    }));

  const userName = session.user.name ?? session.user.email?.split("@")[0] ?? null;
  return <SolChatView conversation={conversation} initialMessages={initialMessages} userName={userName} />;
}
