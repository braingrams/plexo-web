import { NextRequest, NextResponse } from "next/server";
import { resolveStrataCaller } from "@/lib/strata/caller";
import { ProjectBuild } from "@/lib/db/projectEntities";
import { buildReport } from "@/lib/projects/pipeline";
import { appError } from "@/lib/projects/appAccess";

/**
 * GET /api/v1/strata/projects/<id>/publish/<buildId> — how a publish is going. Poll until pending is false:
 * { appId, ok, pending, summary, errors[], previewUrl, liveUrl }. Same Charisol sign-in as the publish call.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; buildId: string }> }): Promise<NextResponse> {
  const resolved = await resolveStrataCaller(request);
  if (!resolved) return NextResponse.json({ error: "Sign in with your Charisol account to continue.", code: "unauthorized" }, { status: 401 });
  const { buildId } = await params;
  try {
    const { data: build } = await ProjectBuild.get({ id: buildId }).go({ attributes: ["organizationId", "templateId"] });
    if (!build || build.organizationId !== resolved.organizationId) return NextResponse.json({ error: "That publish wasn't found." }, { status: 404 });
    return NextResponse.json({ appId: build.templateId, ...(await buildReport(buildId)) });
  } catch (err) {
    return appError(err);
  }
}
