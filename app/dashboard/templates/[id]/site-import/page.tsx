import { prisma } from "@/server/prisma";
import { requireSiteImportAccess } from "@/lib/siteImport/pageAuth";
import { SiteImportClient } from "./SiteImportClient";

const NON_TERMINAL_PHASES = ["PENDING", "DETECTING", "DISCOVERING", "FETCHING", "REWRITING", "PAUSED_ERROR"] as const;

export default async function SiteImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteImportAccess(id, `/dashboard/templates/${id}/site-import`);

  const activeJob = await prisma.siteImportJob.findFirst({
    where: { templateId: access.templateId, phase: { in: [...NON_TERMINAL_PHASES] } },
    orderBy: { createdAt: "desc" },
  });
  // A just-finished job still gets shown (report screen) until the user leaves this page.
  const recentJob = activeJob ?? (await prisma.siteImportJob.findFirst({ where: { templateId: access.templateId }, orderBy: { createdAt: "desc" } }));

  return (
    <SiteImportClient
      templateId={access.templateId}
      templateName={access.templateName}
      isUltra={access.isUltra}
      initialJob={
        recentJob
          ? {
              id: recentJob.id,
              phase: recentJob.phase,
              platform: recentJob.platform,
              importBlogPosts: recentJob.importBlogPosts,
              totalPages: recentJob.totalPages,
              processedPages: recentJob.processedPages,
              errors: Array.isArray(recentJob.errors) ? (recentJob.errors as string[]) : [],
              lastHeartbeatAt: recentJob.lastHeartbeatAt ? recentJob.lastHeartbeatAt.toISOString() : null,
            }
          : null
      }
    />
  );
}
