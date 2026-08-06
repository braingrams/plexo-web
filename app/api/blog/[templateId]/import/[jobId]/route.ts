import { NextRequest, NextResponse } from "next/server";
import { ImportJobStatus } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { isValidUuid } from "@/server/slug";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  const job = await prisma.importJob.findFirst({ where: { id: jobId, templateId: resolved.context.templateId } });
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

  const job = await prisma.importJob.findFirst({ where: { id: jobId, templateId: resolved.context.templateId } });
  if (!job) return NextResponse.json({ error: "Import job not found." }, { status: 404 });

  // Posts already imported stay — cancelling only stops future batches (the
  // self-continuation chain checks status and no-ops once it's no longer RUNNING).
  await prisma.importJob.update({ where: { id: jobId }, data: { status: ImportJobStatus.CANCELLED, finishedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
