import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { Template } from "@/lib/db/contentEntities";
import { lockedTierFor } from "@/lib/ai/solEngine";
import { SolMessage } from "@/lib/db/solEntities";
import { ensureAppConversation } from "@/lib/projects/appConversation";
import { appSummary } from "@/lib/projects/summary";
import { SolSidebarProvider } from "../../sol/_components/SolSidebarContext";
import type { ConversationSummary, SolMessage as SolMessageShape } from "../../sol/_components/types";
import { AppEditor } from "../_components/AppEditor";
import { User } from "@/lib/db/coreEntities";
import { usesNewShell } from "@/lib/dashboardVersions/state";
import { userExperience } from "@/lib/dashboardV3/profile";
import { advancedHref } from "@/lib/dashboardV3/hubAdvanced";
import { HUB_SECTION_FOR_PANEL } from "@/lib/dashboardV3/appEditorLinks";

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

  // On the new dashboard, people on the full view already have Data, People, Settings and the rest on the app's own page,
  // so the editor links there instead of showing them a second time.
  const { data: me } = await User.get({ id: session.user.id }).go();
  const hubLinks = (await usesNewShell(me)) && userExperience(me) === "pro";
  const hubSection = query.panel ? HUB_SECTION_FOR_PANEL[query.panel] : undefined;
  if (hubLinks && hubSection) redirect(advancedHref(id, hubSection));

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

  const lockedModelTier = await lockedTierFor(session.user.id);

  return (
    <SolSidebarProvider>
      <AppEditor
        appId={id}
        initialSummary={await appSummary(app)}
        conversation={conversation}
        initialMessages={initialMessages}
        userName={session.user.name ?? session.user.email?.split("@")[0] ?? null}
        initialPrompt={query.prompt ?? null}
        initialPlan={query.plan ?? null}
        lockedModelTier={lockedModelTier}
       
        initialPanel={query.panel ?? null}
        hubLinks={hubLinks}
        addSecretName={query.add ?? null}
        // Stock photo search in the Design tab — the same keys the site editor uses.
        stockKeys={{ unsplash: process.env.UNSPLASH_KEY || undefined, pexels: process.env.PEXELS_KEY || undefined, pixabay: process.env.PIXABAY_KEY || undefined }}
      />
    </SolSidebarProvider>
  );
}
