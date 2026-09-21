import { notFound, redirect } from "next/navigation";
import type { TemplateJSON } from "@charisol/plexo-sdk";

import { auth } from "@/server/authDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { findRootTemplateId } from "@/lib/siteLayoutDynamo";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { resolveActiveApiKeyForUser } from "@/lib/ai/resolveUserAiKey";

import { TemplateEditorDynamic } from "./template-editor-dynamic";
import { RawFileEditor } from "./raw-file-editor";

function isTemplateJson(value: unknown): value is TemplateJSON {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const body = (value as { body?: unknown }).body;
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const rows = (body as { rows?: unknown }).rows;
  return Array.isArray(rows);
}

const BLANK_TEMPLATE_SHELL: TemplateJSON = {
  body: {
    style: {
      background: "#0b0f19",
      padding: "24px",
    },
    rows: [],
  },
};

export default async function TemplateEditorPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/auth/login?redirectTo=/dashboard/templates/${params.id}`);
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: template } = await Template.get({ id: params.id }).go();
  if (!template || template.organizationId !== orgResolution.organizationId) {
    notFound();
  }

  const [{ data: user }, activeApiKey] = await Promise.all([
    User.get({ id: session.user.id }).go(),
    resolveActiveApiKeyForUser(session.user.id),
  ]);

  // Commerce (and Site Layout) are scoped per SITE (the root Template — parentId null),
  // not per page, so a sub-page's editor needs to walk up to the root to know whether to
  // show the Commerce block palette / where to link Site Layout. Most sites are only one
  // level deep, but the page tree can nest further.
  const rootTemplateId = await findRootTemplateId(
    template.id,
    template.parentId ?? null,
  );
  const { data: commerceSettings } = await CommerceSettings.get({
    templateId: rootTemplateId,
  }).go();

  const tierFeatures = getTierFeatures(user?.subscriptionPlan);

  if (template.sourceType === "RAW_UPLOAD") {
    return (
      <RawFileEditor
        templateId={template.id}
        templateName={template.name}
        templateKind={template.kind}
        subscriptionPlan={user?.subscriptionPlan ?? "FREE"}
        useAi={activeApiKey?.useAi ?? tierFeatures.aiEnabled}
        aiProvider={activeApiKey?.aiProvider ?? "openai"}
        aiTier={activeApiKey?.aiTier ?? tierFeatures.sdkAiTier}
      />
    );
  }

  const liveDesignJson = isTemplateJson(template.designJson)
    ? template.designJson
    : BLANK_TEMPLATE_SHELL;
  const initialDesignJson = isTemplateJson(template.draftJson)
    ? template.draftJson
    : liveDesignJson;
  const hasUnpublishedChanges = template.draftJson != null;

  const unsplashKey = process.env.UNSPLASH_KEY || "";
  const pexelsKey = process.env.PEXELS_KEY || "";
  const pixabayKey = process.env.PIXABAY_KEY || "";

  return (
    <TemplateEditorDynamic
      templateId={template.id}
      templateName={template.name}
      templateKind={template.kind}
      templateParentId={template.parentId ?? null}
      initialDesignJson={initialDesignJson}
      liveDesignJson={liveDesignJson}
      hasUnpublishedChanges={hasUnpublishedChanges}
      subscriptionPlan={user?.subscriptionPlan ?? "FREE"}
      useAi={activeApiKey?.useAi ?? tierFeatures.aiEnabled}
      aiProvider={activeApiKey?.aiProvider ?? "openai"}
      aiTier={activeApiKey?.aiTier ?? tierFeatures.sdkAiTier}
      unsplashKey={unsplashKey}
      pexelsKey={pexelsKey}
      pixabayKey={pixabayKey}
      currentUserId={session.user.id}
      currentUserRole={orgResolution.role}
      organizationId={orgResolution.organizationId}
      isBlogLayout={template.isBlogLayout ?? false}
      commerceEnabled={commerceSettings?.enabled ?? false}
      maildripConnected={Boolean(commerceSettings?.maildripApiKeyEncrypted)}
      rootTemplateId={rootTemplateId}
    />
  );
}
