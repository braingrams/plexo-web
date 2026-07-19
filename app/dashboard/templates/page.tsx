import { TemplateKind } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

import { TemplatesClient } from "./templates-client";

type TemplateSummary = {
  id: string;
  name: string;
  kind: TemplateKind;
  compiledHtml: string;
  createdAt: string;
  updatedAt: string;
};

function serializeTemplate(record: {
  id: string;
  name: string;
  kind: TemplateKind;
  compiledHtml: string;
  createdAt: Date;
  updatedAt: Date;
}): TemplateSummary {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    compiledHtml: record.compiledHtml,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export default async function TemplatesDashboardPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/templates");
  }

  const templates = await prisma.template.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      kind: true,
      compiledHtml: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return <TemplatesClient initialTemplates={templates.map(serializeTemplate)} />;
}
