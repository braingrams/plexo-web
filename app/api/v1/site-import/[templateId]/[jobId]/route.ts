import { NextRequest, NextResponse } from "next/server";
import { SiteImportPhase } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { resolveSiteImportSite } from "@/lib/siteImport/adminAuth";
import { isValidUuid } from "@/server/slug";

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
    include: { pages: { orderBy: { updatedAt: "desc" }, take: 50 } },
  });
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  return NextResponse.json({ job });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveSiteImportSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const job = await prisma.siteImportJob.findFirst({ where: { id: jobId, templateId: resolved.context.templateId } });
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  // Pages/posts already imported stay — cancelling only stops future steps.
  await prisma.siteImportJob.update({ where: { id: jobId }, data: { phase: SiteImportPhase.CANCELLED, finishedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
