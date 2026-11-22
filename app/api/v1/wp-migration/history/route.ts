import { NextRequest, NextResponse } from "next/server";
import { Template } from "@/lib/db/contentEntities";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { resolveMigrationAccess } from "@/lib/wpMigration/access";
import { buildHistories, stepsFor, type RunCounts } from "@/lib/wpMigration/history";

/** GET /api/v1/wp-migration/history[?site=<templateId>] — every WordPress move on this account (or one site), with each run and what it moved. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return resolved.error;
  const site = request.nextUrl.searchParams.get("site");
  const { data } = await WpMigrationJob.query.byOrg({ organizationId: resolved.access.organizationId }).go({ pages: "all" });
  const jobs = site ? data.filter((j) => j.templateId === site) : data;
  const histories = buildHistories(jobs);
  const names = new Map<string, string>();
  await Promise.all(
    histories.map(async (h) => {
      const { data: t } = await Template.get({ id: h.templateId }).go();
      names.set(h.templateId, t?.name || "Untitled site");
    }),
  );
  const latest = new Map(jobs.map((j) => [j.templateId, j] as const));
  return NextResponse.json({
    sites: histories.map((h) => ({
      ...h,
      siteName: names.get(h.templateId) ?? "Untitled site",
      steps: stepsFor(jobs.filter((j) => j.id === h.latestJobId)[0]?.counts as RunCounts | undefined),
      canRerun: !h.active && latest.has(h.templateId),
    })),
  });
}
