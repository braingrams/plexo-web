import { NextRequest, NextResponse } from "next/server";
import { ImportJob } from "@/lib/db/importEntities";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { isValidUuid } from "@/server/slugDynamo";
import { processImportBatch } from "@/lib/blogImport/runBatchDynamo";

/**
 * Processes exactly one batch and returns. This is the workhorse the dashboard tab calls
 * repeatedly (app/dashboard/templates/[id]/blog/import/ImportClient.tsx) to drive an import
 * batch-by-batch while the tab is open — the browser is the thing calling this in a loop,
 * not the server calling itself, which is deliberate: a server route that re-triggers
 * itself over HTTP looks like a request loop to Vercel's own loop protection and gets cut
 * off with a 508 after a handful of hops. The same endpoint also serves as the manual
 * "Retry now" button for a paused/stalled job, since both cases are just "run one more
 * batch right now" — the tab being closed is covered by the once-a-day stalled-job cron
 * (app/api/internal/blog-import/resume-stalled) instead.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const { data: job } = await ImportJob.get({ templateId: resolved.context.templateId, id: jobId }).go();
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const result = await processImportBatch(resolved.context.templateId, jobId);
  return NextResponse.json({ done: result.done, status: result.status });
}
