import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { TemplateJSON } from "@plexo/sdk";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { getTierFeatures } from "@/lib/subscription";

import { TemplateEditorClient } from "./template-editor-client";

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

  const [template, user] = await Promise.all([
    prisma.template.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
      select: {
        id: true,
        name: true,
        kind: true,
        designJson: true,
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

  const initialDesignJson = isTemplateJson(template.designJson)
    ? template.designJson
    : BLANK_TEMPLATE_SHELL;

  const activeApiKey = user?.apiKeys[0] ?? null;
  const tierFeatures = getTierFeatures(user?.subscriptionPlan);

  return (
    <TemplateEditorClient
      templateId={template.id}
      templateName={template.name}
      templateKind={template.kind}
      initialDesignJson={initialDesignJson}
      subscriptionPlan={user?.subscriptionPlan ?? "ULTRA"}
      useAi={activeApiKey?.useAi ?? tierFeatures.aiEnabled}
      aiProvider={activeApiKey?.aiProvider ?? "openai"}
      aiTier={activeApiKey?.aiTier ?? tierFeatures.sdkAiTier}
    />
  );
}
