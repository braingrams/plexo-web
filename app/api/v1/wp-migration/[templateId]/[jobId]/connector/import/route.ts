import { NextRequest, NextResponse } from "next/server";
import { revalidateBlogPost } from "@/lib/blog/revalidateDynamo";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { isValidUuid } from "@/lib/slugUtils";
import { assertOwnSite, resolveMigrationAccess } from "@/lib/wpMigration/access";
import { ConnectorError, runExtrasStep } from "@/lib/wpMigration/connector";

export const maxDuration = 60;

/** POST — import the next batch of private data through the plugin; call until extras.stage is "done". */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string; jobId: string }> }): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return resolved.error;
  const notOwn = await assertOwnSite(resolved.access, templateId);
  if (notOwn) return notOwn;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Migration not found." }, { status: 404 });
  const { data: job } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!job) return NextResponse.json({ error: "Migration not found." }, { status: 404 });
  try {
    return NextResponse.json({ extras: await runExtrasStep(job, revalidateBlogPost) });
  } catch (err) {
    if (err instanceof ConnectorError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
