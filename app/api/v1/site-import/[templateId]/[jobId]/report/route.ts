import { NextRequest, NextResponse } from "next/server";
import { SiteImportPageOutcome } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { resolveSiteImportSite } from "@/lib/siteImport/adminAuth";
import { isValidUuid } from "@/server/slug";
import { describeInteractiveFeatureFlag } from "@/lib/siteImport/interactiveFeatureDetect";

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

  const job = await prisma.siteImportJob.findFirst({
    where: { id: jobId, templateId: resolved.context.templateId },
    include: { pages: true, assetBlobs: { select: { id: true } } },
  });
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const urlMap = (job.urlMap && typeof job.urlMap === "object" ? (job.urlMap as Record<string, string>) : {});

  const pages = job.pages.map((p) => ({
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
    pagesCreated: job.pages.filter((p) => p.outcome === SiteImportPageOutcome.PAGE_CREATED).length,
    postsCreated: job.pages.filter((p) => p.outcome === SiteImportPageOutcome.POST_CREATED).length,
    pagesFailed: job.pages.filter((p) => p.outcome === SiteImportPageOutcome.FAILED).length,
    assetsInternalized: job.assetBlobs.length,
    warnings: Array.isArray(job.warnings) ? job.warnings : [],
    errors: Array.isArray(job.errors) ? job.errors : [],
    pages,
  });
}
