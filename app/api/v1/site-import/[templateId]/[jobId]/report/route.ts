import { NextRequest, NextResponse } from "next/server";
import { resolveSiteImportSite } from "@/lib/siteImport/adminAuthDynamo";
import { isValidUuid } from "@/lib/slugUtils";
import { describeInteractiveFeatureFlag } from "@/lib/siteImport/interactiveFeatureDetect";
import { SiteImportJob, SiteImportPage, SiteImportAssetBlob } from "@/lib/db/importEntities";

/**
 * GET /api/v1/site-import/[templateId]/[jobId]/report
 *
 * A dedicated, shaped summary for the post-import report screen — separate from the plain
 * GET .../[jobId] status poll (used every few seconds while a job runs) since the report
 * wants a fuller per-page join the live-progress poll doesn't need on every tick.
 */
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

  const [{ data: jobPages }, { data: assetBlobs }] = await Promise.all([
    SiteImportPage.query.primary({ jobId }).go(),
    SiteImportAssetBlob.query.primary({ jobId }).go(),
  ]);

  const urlMap = (job.urlMap && typeof job.urlMap === "object" ? (job.urlMap as Record<string, string>) : {});

  const pages = jobPages.map((p) => ({
    sourceUrl: p.sourceUrl,
    outcome: p.outcome,
    plexoPath: urlMap[p.sourceUrl] ?? null,
    heuristicExtraction: p.heuristicExtraction,
    usedHeadless: p.usedHeadless,
    error: p.error,
    interactiveFeatures: (Array.isArray(p.interactiveFeatureFlags) ? (p.interactiveFeatureFlags as string[]) : []).map((flag) => ({
      flag,
      label: describeInteractiveFeatureFlag(flag),
    })),
  }));

  return NextResponse.json({
    phase: job.phase,
    pagesCreated: jobPages.filter((p) => p.outcome === "PAGE_CREATED").length,
    postsCreated: jobPages.filter((p) => p.outcome === "POST_CREATED").length,
    pagesFailed: jobPages.filter((p) => p.outcome === "FAILED").length,
    assetsInternalized: assetBlobs.length,
    warnings: Array.isArray(job.warnings) ? job.warnings : [],
    errors: Array.isArray(job.errors) ? job.errors : [],
    pages,
  });
}
