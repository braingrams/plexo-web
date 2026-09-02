import { NextRequest, NextResponse } from "next/server";
import { resolveSiteImportSite } from "@/lib/siteImport/adminAuthDynamo";
import { isValidUuid } from "@/server/slug";
import { processSiteImportStep } from "@/lib/siteImport/runJobDynamo";
import { SiteImportJob } from "@/lib/db/importEntities";

/**
 * Processes exactly one bounded step and returns. Same role as blog-import's
 * .../import/[jobId]/retry/route.ts: the dashboard tab (SiteImportClient.tsx) calls this
 * repeatedly in a loop while open to drive the job phase-by-phase — a server route
 * re-triggering itself over HTTP looks like a request loop to Vercel's own loop protection
 * and gets cut off (508) after a handful of hops, so the browser is the thing looping, not
 * the server. Also serves as the manual "Retry now" action for a PAUSED_ERROR job, since both
 * are just "run the next step now." A closed tab is covered by the once-a-day stalled-job
 * cron (app/api/internal/site-import/resume-stalled) instead.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveSiteImportSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const { data: job } = await SiteImportJob.get({ templateId: resolved.context.templateId, id: jobId }).go();
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const result = await processSiteImportStep(resolved.context.templateId, jobId);
  return NextResponse.json({ done: result.done, phase: result.phase });
}
