import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { ImportJobStatus } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { isValidUuid } from "@/server/slug";
import { processImportBatch } from "@/lib/blogImport/runBatch";
import { continueImportChain } from "@/lib/blogImport/continueChain";

/**
 * Lets a logged-in dashboard user manually resume a paused/stalled job instead of waiting
 * for the once-a-day resume-stalled cron backstop (app/api/internal/blog-import/resume-stalled)
 * — same processImportBatch + self-continuation pattern as app/api/internal/blog-import/process,
 * just triggered by the template's own admin auth rather than the internal bearer token.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const job = await prisma.importJob.findFirst({ where: { id: jobId, templateId: resolved.context.templateId } });
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const result = await processImportBatch(jobId);

  if (!result.done && result.status === ImportJobStatus.RUNNING) {
    after(() => continueImportChain(jobId));
  }

  return NextResponse.json({ done: result.done, status: result.status });
}
