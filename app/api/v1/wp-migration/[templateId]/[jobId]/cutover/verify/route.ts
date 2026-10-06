import { NextRequest, NextResponse } from "next/server";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { isValidUuid } from "@/lib/slugUtils";
import { assertOwnSite, resolveMigrationAccess } from "@/lib/wpMigration/access";
import { verifyLive, type CutoverPlan } from "@/lib/wpMigration/cutover";
import { refreshReport, type MigrationReport } from "@/lib/wpMigration/report";
import { donationPaymentsReady } from "@/lib/wpMigration/runJobDynamo";

export const maxDuration = 60;

/** POST — check, on the real domain, that Plexo now serves every migrated URL and nothing would break if WordPress were cancelled. */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string; jobId: string }> }): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return resolved.error;
  const notOwn = await assertOwnSite(resolved.access, templateId);
  if (notOwn) return notOwn;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Migration not found." }, { status: 404 });
  const { data: job } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!job?.report) return NextResponse.json({ error: "Finish the migration first." }, { status: 400 });
  const plan = (job.cutover as { plan?: CutoverPlan } | undefined)?.plan;
  if (!plan) return NextResponse.json({ error: "Open the domain switch steps first." }, { status: 400 });
  const report = refreshReport(job.report as MigrationReport, await donationPaymentsReady(templateId));
  const verification = await verifyLive(job, plan, report);
  await WpMigrationJob.patch({ templateId, id: jobId }).set({ cutover: { ...(job.cutover as object), verification } }).go();
  return NextResponse.json({ verification });
}
