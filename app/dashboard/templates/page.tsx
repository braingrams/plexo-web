import { TemplateKind } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";

import { TemplatesClient } from "./templates-client";

type TemplateSummary = {
  id: string;
  name: string;
  kind: TemplateKind;
  compiledHtml: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
};

function serializeTemplate(record: {
  id: string;
  name: string;
  kind: TemplateKind;
  compiledHtml: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { pages: number };
}): TemplateSummary {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    compiledHtml: record.compiledHtml,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    pageCount: record._count.pages,
  };
}

export default async function TemplatesDashboardPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/templates");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Sub-pages (parentId set) live inside their parent's editor, not as
  // separate top-level entries here.
  const templates = await prisma.template.findMany({
    where: { organizationId: orgResolution.organizationId, parentId: null },
    // Secondary key matters: the org-backfill migration bulk-updated every template's
    // organizationId in one updateMany, and Prisma's @updatedAt auto-bumps on ANY update
    // through the query engine — so a lot of rows now share the exact same updatedAt
    // from that migration moment. Without a tie-breaker, Postgres returns those ties in
    // arbitrary (often near-creation-order) order, which read as "ascending" instead of
    // newest-edited-first.
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      compiledHtml: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { pages: true } },
    },
  });

  return <TemplatesClient initialTemplates={templates.map(serializeTemplate)} />;
}
