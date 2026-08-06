import { prisma } from "@/server/prisma";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuth";
import { ImportClient } from "./ImportClient";

export default async function BlogImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/import`);

  const activeJob = await prisma.importJob.findFirst({
    where: { templateId: access.templateId, status: { in: ["PENDING", "RUNNING", "PAUSED_ERROR"] } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <ImportClient
      templateId={access.templateId}
      templateName={access.templateName}
      initialJob={
        activeJob
          ? {
              id: activeJob.id,
              status: activeJob.status,
              totalPosts: activeJob.totalPosts,
              processedPosts: activeJob.processedPosts,
              errors: Array.isArray(activeJob.errors) ? (activeJob.errors as string[]) : [],
            }
          : null
      }
    />
  );
}
