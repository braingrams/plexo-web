import { NextRequest, NextResponse } from "next/server";
import { requireUser, appError } from "@/lib/projects/appAccess";
import { ProjectBuild } from "@/lib/db/projectEntities";
import { buildReport } from "@/lib/projects/pipeline";

/** GET /api/v1/deploy/<buildId> — a deploy's status. Poll until pending is false:
 *  { ok, pending, status, summary, errors[], typeProblems[], previewUrl, liveUrl, … } */
export async function GET(request: NextRequest, { params }: { params: Promise<{ buildId: string }> }): Promise<NextResponse> {
  const resolved = await requireUser(request);
  if (resolved instanceof NextResponse) return resolved;
  const { buildId } = await params;
  try {
    const { data: build } = await ProjectBuild.get({ id: buildId }).go({ attributes: ["organizationId", "templateId"] });
    if (!build || build.organizationId !== resolved.organizationId) return NextResponse.json({ error: "Deploy not found." }, { status: 404 });
    const report = await buildReport(buildId);
    return NextResponse.json({ appId: build.templateId, ...report });
  } catch (err) {
    return appError(err);
  }
}
