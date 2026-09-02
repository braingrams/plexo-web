import { NextRequest, NextResponse } from "next/server";
import { ImportJob } from "@/lib/db/importEntities";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { isValidUuid } from "@/server/slugDynamo";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const { data: job } = await ImportJob.get({ templateId: resolved.context.templateId, id: jobId }).go();
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  return NextResponse.json({ job });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const { data: job } = await ImportJob.get({ templateId: resolved.context.templateId, id: jobId }).go();
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  // Posts already imported stay — cancelling only stops future batches (the
  // self-continuation chain checks status and no-ops once it's no longer RUNNING).
  await ImportJob.patch({ templateId: resolved.context.templateId, id: jobId })
    .set({ status: "CANCELLED", finishedAt: new Date().toISOString() })
    .go();
  return NextResponse.json({ ok: true });
}
