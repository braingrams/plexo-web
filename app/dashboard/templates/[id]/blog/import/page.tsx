import { ImportJob } from "@/lib/db/importEntities";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuthDynamo";
import { ImportClient } from "./ImportClient";

export default async function BlogImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/import`);

  // No indexed "most recent active job" query (ImportJob's primary SK is id, not
  // createdAt — same as app/api/blog/[templateId]/import/route.ts's GET) — fetch the
  // partition and pick in memory, small in practice.
  const { data: jobs } = await ImportJob.query.primary({ templateId: access.templateId }).go();
  const activeJobs = jobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING" || j.status === "PAUSED_ERROR");
  activeJobs.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const activeJob = activeJobs[0] ?? null;

  return (
    <ImportClient
      templateId={access.templateId}
      templateName={access.templateName}
      initialJob={
        activeJob
          ? {
              id: activeJob.id,
              status: activeJob.status ?? "PENDING",
              totalPosts: activeJob.totalPosts ?? null,
              processedPosts: activeJob.processedPosts ?? 0,
              errors: Array.isArray(activeJob.errors) ? (activeJob.errors as string[]) : [],
              lastHeartbeatAt: activeJob.lastHeartbeatAt ?? null,
            }
          : null
      }
    />
  );
}
