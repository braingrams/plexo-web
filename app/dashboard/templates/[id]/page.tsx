import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { TemplateJSON } from "@charisol/plexo-sdk";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { getTierFeatures } from "@/lib/subscription";
import { ensureActiveOrganization } from "@/server/org";
import { findRootTemplateId } from "@/lib/siteLayout";

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

export default async function TemplateEditorPage(
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect(`/auth/login?redirectTo=/dashboard/templates/${params.id}`);
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const [template, user] = await Promise.all([
    prisma.template.findFirst({
      where: {
        id: params.id,
        organizationId: orgResolution.organizationId,
      },
      select: {
        id: true,
        name: true,
        kind: true,
        parentId: true,
        designJson: true,
        sourceType: true,
        isBlogLayout: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        subscriptionPlan: true,
        apiKeys: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            useAi: true,
            aiProvider: true,
            aiTier: true,
          },
        },
      },
    }),
  ]);

  if (!template) {
    notFound();
  }

  // Commerce (and Site Layout) are scoped per SITE (the root Template — parentId null),
  // not per page, so a sub-page's editor needs to walk up to the root to know whether to
  // show the Commerce block palette / where to link Site Layout. Most sites are only one
  // level deep, but the page tree can nest further.
  const rootTemplateId = await findRootTemplateId(template.id, template.parentId);
  const commerceSettings = await prisma.commerceSettings.findUnique({
    where: { templateId: rootTemplateId },
    select: { enabled: true, maildripApiKeyEncrypted: true },
  });

  const activeApiKey = user?.apiKeys[0] ?? null;
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

  const initialDesignJson = isTemplateJson(template.designJson)
    ? template.designJson
    : BLANK_TEMPLATE_SHELL;

  const unsplashKey = process.env.UNSPLASH_KEY || "";
  const pexelsKey = process.env.PEXELS_KEY || "";
  const pixabayKey = process.env.PIXABAY_KEY || "";

  return (
    <TemplateEditorDynamic
      templateId={template.id}
      templateName={template.name}
      templateKind={template.kind}
      templateParentId={template.parentId}
      initialDesignJson={initialDesignJson}
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
      isBlogLayout={template.isBlogLayout}
      commerceEnabled={commerceSettings?.enabled ?? false}
      maildripConnected={Boolean(commerceSettings?.maildripApiKeyEncrypted)}
      rootTemplateId={rootTemplateId}
    />
  );
}
