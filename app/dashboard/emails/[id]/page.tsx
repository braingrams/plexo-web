import { notFound, redirect } from "next/navigation";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { requireHubContext } from "@/lib/dashboardV3/hubData";
import { resolveActiveApiKeyForUser } from "@/lib/ai/resolveUserAiKey";
import { getTierFeatures } from "@/lib/subscription";
import { EmailHtmlEditor } from "../../templates/[id]/email-html-editor";
import { EditorFrame } from "../../_components/EditorTheme";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email" };

/**
 * An email written as HTML, opened inside the dashboard (sidebar and top bar around it) instead of full screen. Emails built
 * on the visual canvas keep opening in their own editor.
 */
export default async function EmailHtmlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireHubContext(`/dashboard/emails/${id}`);
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== ctx.organizationId) notFound();
  if (template.kind !== "EMAIL" || template.sourceType !== "RAW_UPLOAD") redirect(`/dashboard/templates/${id}`);

  const [{ data: user }, activeApiKey] = await Promise.all([User.get({ id: ctx.userId }).go(), resolveActiveApiKeyForUser(ctx.userId)]);
  void user;
  const useAi = activeApiKey?.useAi ?? getTierFeatures(ctx.plan).aiEnabled;

  return (
    <EditorFrame v3>
      <EmailHtmlEditor templateId={template.id} templateName={template.name} initialHtml={template.compiledHtml ?? ""} useAi={useAi} embedded />
    </EditorFrame>
  );
}
