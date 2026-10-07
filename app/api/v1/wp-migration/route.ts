import { NextRequest, NextResponse } from "next/server";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { resolveMigrationAccess } from "@/lib/wpMigration/access";
import { continueInBackground } from "@/lib/wpMigration/background";
import { startWordPressMigration } from "@/lib/wpMigration/startMigration";

export const maxDuration = 60;

/** GET /api/v1/wp-migration — this organization's migrations, newest first (the dashboard resumes from here). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return resolved.error;
  const { data } = await WpMigrationJob.query.byOrg({ organizationId: resolved.access.organizationId }).go({ order: "desc", limit: 20 });
  return NextResponse.json({
    migrations: data.map((j) => ({
      id: j.id,
      templateId: j.templateId,
      sourceUrl: j.sourceUrl,
      phase: j.phase,
      siteName: (j.install as { siteName?: string } | undefined)?.siteName ?? null,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt ?? null,
    })),
  });
}

/**
 * POST /api/v1/wp-migration — start moving a WordPress site to Plexo.
 *
 * Creates a brand-new Plexo site for it (never overwrites an existing one) and the job that
 * fills it. Body: { sourceUrl, ownershipAttested: true, acceptAup?: true, drivenByDashboard?: true }
 *
 * It then runs on the server by itself; the dashboard (drivenByDashboard) drives it while
 * open instead and hands it over when the tab closes, so its start stays instant.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveMigrationAccess(request, { permission: "create" });
  if ("error" in resolved) return resolved.error;
  const body = (await request.json().catch(() => ({}))) as { sourceUrl?: string; ownershipAttested?: boolean; acceptAup?: boolean; drivenByDashboard?: boolean };
  const result = await startWordPressMigration(resolved.access, body);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        requiresOwnershipAttestation: result.requiresOwnershipAttestation,
        requiresAupAcceptance: result.requiresAupAcceptance,
        aupUrl: result.requiresAupAcceptance ? "/legal/acceptable-use" : undefined,
        notWordPress: result.notWordPress,
        existing: result.existing,
      },
      { status: result.status },
    );
  }
  if (body.drivenByDashboard !== true) await continueInBackground(result.templateId, result.jobId);
  return NextResponse.json({ jobId: result.jobId, templateId: result.templateId }, { status: 201 });
}
