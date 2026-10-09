import { NextRequest, NextResponse } from "next/server";
import { PublishedDomain } from "@/lib/db/contentEntities";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { isValidUuid } from "@/lib/slugUtils";
import { assertOwnSite, resolveMigrationAccess } from "@/lib/wpMigration/access";
import { estimateSecondsLeft, type EstimateCounts } from "@/lib/wpMigration/estimate";
import { refreshReport, type MigrationReport } from "@/lib/wpMigration/report";
import { donationPaymentIssue, donationPaymentsReady } from "@/lib/wpMigration/runJobDynamo";

/** GET — a migration's live progress, and its full report once finished. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return resolved.error;
  const notOwn = await assertOwnSite(resolved.access, templateId);
  if (notOwn) return notOwn;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Migration not found." }, { status: 404 });

  const [{ data: job }, { data: domains }] = await Promise.all([
    WpMigrationJob.get({ templateId, id: jobId }).go(),
    PublishedDomain.query.primary({ templateId }).go(),
  ]);
  if (!job) return NextResponse.json({ error: "Migration not found." }, { status: 404 });

  return NextResponse.json({
    job: {
      id: job.id,
      templateId: job.templateId,
      sourceUrl: job.sourceUrl,
      phase: job.phase,
      // Which step a paused migration stopped in, so the progress list can show it.
      pausedIn: (job.planState as { pausedIn?: string } | undefined)?.pausedIn ?? null,
      install: job.install,
      counts: job.counts ?? null,
      // Shown as "about 2 hours left"; null while the site's size is still being worked out.
      estimatedSecondsLeft: estimateSecondsLeft({ phase: job.phase ?? "PENDING", counts: (job.counts as EstimateCounts | undefined) ?? null, startedAt: job.startedAt }),
      plugins: job.plugins ?? null,
      report: job.report ? refreshReport(job.report as MigrationReport, await donationPaymentsReady(templateId), await donationPaymentIssue(templateId)) : null,
      errors: Array.isArray(job.errors) ? (job.errors as string[]).slice(-20) : [],
      warnings: job.warnings ?? [],
      lastHeartbeatAt: job.lastHeartbeatAt ?? null,
      processing: job.processing ?? false,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt ?? null,
    },
    // Lets the report screen tick off "Preview on Plexo" / "Point your domain" as they happen.
    domains: domains.map((d) => ({ domain: d.domain, type: d.type, active: d.active ?? true, dnsVerified: d.dnsVerified ?? false, certificateStatus: (d as { certificateStatus?: string }).certificateStatus ?? null })),
  });
}

/** PATCH { dismissBanner: true } — the owner closed the "has moved to Plexo" banner. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return resolved.error;
  const notOwn = await assertOwnSite(resolved.access, templateId);
  if (notOwn) return notOwn;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Migration not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { dismissBanner?: boolean };
  if (body.dismissBanner !== true) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  try {
    await WpMigrationJob.patch({ templateId, id: jobId }).set({ bannerDismissedAt: new Date().toISOString() }).go();
  } catch {
    return NextResponse.json({ error: "Migration not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
