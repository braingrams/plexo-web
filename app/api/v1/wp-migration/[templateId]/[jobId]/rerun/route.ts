import { NextRequest, NextResponse } from "next/server";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { isValidUuid } from "@/lib/slugUtils";
import { assertOwnSite, resolveMigrationAccess } from "@/lib/wpMigration/access";
import { continueInBackground } from "@/lib/wpMigration/background";
import { isRerunScope } from "@/lib/wpMigration/history";
import { previewRerun, startRerun } from "@/lib/wpMigration/rerun";

export const maxDuration = 60;

/**
 * POST { scope: "all" | "POSTS" | "PAGES" | "ASSETS" | "PRODUCTS", confirm?: true }
 * Without confirm: says what running it again would do and changes nothing. With confirm: starts the run.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; jobId: string }> },
): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return resolved.error;
  const notOwn = await assertOwnSite(resolved.access, templateId);
  if (notOwn) return notOwn;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "We couldn't find that move." }, { status: 404 });
  const { data: job } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!job || job.organizationId !== resolved.access.organizationId) return NextResponse.json({ error: "We couldn't find that move." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { scope?: unknown; confirm?: unknown };
  if (!isRerunScope(body.scope)) return NextResponse.json({ error: "Choose what to run again." }, { status: 400 });

  if (body.confirm !== true) {
    const p = await previewRerun(templateId, jobId, body.scope);
    return p.ok ? NextResponse.json({ preview: p.preview }) : NextResponse.json({ error: p.error }, { status: p.status });
  }
  const started = await startRerun(templateId, jobId, body.scope);
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
  await continueInBackground(templateId, jobId);
  return NextResponse.json({ started: true, href: `/dashboard/migrate/wordpress?job=${jobId}&site=${templateId}` }, { status: 202 });
}
