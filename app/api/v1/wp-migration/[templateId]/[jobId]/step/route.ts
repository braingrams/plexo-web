import { NextRequest, NextResponse } from "next/server";
import { revalidateBlogPost } from "@/lib/blog/revalidateDynamo";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { isValidUuid } from "@/lib/slugUtils";
import { assertOwnSite, resolveMigrationAccess } from "@/lib/wpMigration/access";
import { processWpMigrationStep } from "@/lib/wpMigration/runJobDynamo";
import { continueInBackground } from "@/lib/wpMigration/background";

export const maxDuration = 60;

/**
 * POST — run the next bounded step of a migration: the "Try again" action for a paused
 * migration, which resumes from the step that paused. With ?handoff=1 it runs nothing itself
 * and has the server carry on in the background — how the migration screen starts (and, if
 * the server ever goes quiet, restarts) a migration it's watching.
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
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Migration not found." }, { status: 404 });

  const { data: job } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!job) return NextResponse.json({ error: "Migration not found." }, { status: 404 });

  if (request.nextUrl.searchParams.get("handoff") === "1") {
    await continueInBackground(templateId, jobId);
    return NextResponse.json({ handedOff: true }, { status: 202 });
  }

  const result = await processWpMigrationStep(templateId, jobId, revalidateBlogPost);
  return NextResponse.json(result);
}
