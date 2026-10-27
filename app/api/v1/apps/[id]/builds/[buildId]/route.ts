import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError } from "@/lib/projects/appAccess";
import { buildReport } from "@/lib/projects/pipeline";
import { readBuildLog } from "@/lib/projects/builds";
import { ProjectBuild } from "@/lib/db/projectEntities";

/** GET [?log=1] — a build's full report: status, errors (file/line/message), type problems,
 * database migrations, function deploys, preview/live URLs. Poll until pending is false. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; buildId: string }> }): Promise<NextResponse> {
  const { id, buildId } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  try {
    // Checked before the report: reading a report can run the build's post-build steps.
    const { data: owner } = await ProjectBuild.get({ id: buildId }).go({ attributes: ["templateId"] });
    const report = owner?.templateId === id ? await buildReport(buildId) : null;
    if (!report) return NextResponse.json({ error: "Build not found." }, { status: 404 });
    const log = request.nextUrl.searchParams.get("log") ? await readBuildLog(id, buildId) : undefined;
    return NextResponse.json({ ...report, ...(log !== undefined ? { log } : {}) });
  } catch (err) {
    return appError(err);
  }
}
