import { NextRequest, NextResponse } from "next/server";
import { resolveSiteImportSite } from "@/lib/siteImport/adminAuthDynamo";
import { isValidUuid } from "@/server/slug";
import { SiteImportJob, SiteImportPage } from "@/lib/db/importEntities";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveSiteImportSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const { data: job } = await SiteImportJob.get({ templateId: resolved.context.templateId, id: jobId }).go();
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const { data: pages } = await SiteImportPage.query.primary({ jobId }).go();
  const sortedPages = pages.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, 50);

  return NextResponse.json({ job: { ...job, pages: sortedPages } });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveSiteImportSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const { data: job } = await SiteImportJob.get({ templateId: resolved.context.templateId, id: jobId }).go();
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  // Pages/posts already imported stay — cancelling only stops future steps.
  await SiteImportJob.patch({ templateId: resolved.context.templateId, id: jobId })
    .set({ phase: "CANCELLED", finishedAt: new Date().toISOString() })
    .go();
  return NextResponse.json({ ok: true });
}
