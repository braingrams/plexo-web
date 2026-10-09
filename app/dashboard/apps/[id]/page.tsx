import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { Template } from "@/lib/db/contentEntities";
import { SolMessage } from "@/lib/db/solEntities";
import { ensureAppConversation } from "@/lib/projects/appConversation";
import { appSummary } from "@/lib/projects/summary";
import { SolSidebarProvider } from "../../sol/_components/SolSidebarContext";
import type { ConversationSummary, SolMessage as SolMessageShape } from "../../sol/_components/types";
import { AppEditor } from "../_components/AppEditor";

export const dynamic = "force-dynamic";

/** The app editor: SOL on the left, the running app (and its code, data, users…) on the right. */
export default async function AppEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?redirectTo=/dashboard/apps/${id}`);
  const org = await ensureActiveOrganization(session.user.id);
  if (org.status === "needs-choice") redirect("/choose-org");

  const { data: app } = await Template.get({ id }).go();
  if (!app || app.organizationId !== org.organizationId) notFound();
  if (app.sourceType !== "REACT_PROJECT") redirect(`/dashboard/templates/${id}`);

  const record = await ensureAppConversation({ userId: session.user.id, organizationId: org.organizationId, appId: id, appName: app.name });
  const conversation: ConversationSummary = {
    id: record.id,
    title: record.title ?? null,
    modelTier: record.modelTier ?? "MEDIUM",
    status: record.status ?? "ACTIVE",
    lastMessageAt: record.lastMessageAt ?? null,
    messageCount: record.messageCount ?? 0,
    createdAt: record.createdAt ?? new Date().toISOString(),
    updatedAt: record.updatedAt ?? new Date().toISOString(),
  };
  const { data: recent } = await SolMessage.query.primary({ conversationId: record.id }).go({ order: "desc", limit: 40 });
  const initialMessages: SolMessageShape[] = recent
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

  return (
    <SolSidebarProvider>
      <AppEditor
        appId={id}
        initialSummary={await appSummary(app)}
        conversation={conversation}
        initialMessages={initialMessages}
        userName={session.user.name ?? session.user.email?.split("@")[0] ?? null}
        initialPrompt={query.prompt ?? null}
        initialPanel={query.panel ?? null}
        addSecretName={query.add ?? null}
      />
    </SolSidebarProvider>
  );
}
