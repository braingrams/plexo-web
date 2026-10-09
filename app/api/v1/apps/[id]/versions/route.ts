import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { listVersions } from "@/lib/projects/fileStore";
import { ensureVersion } from "@/lib/projects/pipeline";
import { ProjectBuild } from "@/lib/db/projectEntities";

type Ctx = { params: Promise<{ id: string }> };

/** GET: version history, newest first. POST { message? }: save the working copy as a version. */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 50, 200);
  const [versions, live] = await Promise.all([
    listVersions(id, limit),
    loaded.app.liveBuildId ? ProjectBuild.get({ id: loaded.app.liveBuildId }).go({ attributes: ["versionId"] }).then((r) => r.data) : null,
  ]);
  return NextResponse.json({
    versions: versions.map((v) => ({
      id: v.id,
      message: v.message,
      source: v.source,
      authorName: v.authorName ?? null,
      fileCount: v.fileCount,
      commitSha: v.commitSha ?? null,
      createdAt: v.createdAt,
      isLive: v.id === live?.versionId,
    })),
  });
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    const result = await ensureVersion(id, { message: typeof body.message === "string" ? body.message : undefined, source: "editor", authorId: loaded.actor.userId, authorName: loaded.actor.userName });
    return NextResponse.json({ versionId: result.versionId, changed: result.changed, diff: result.diff });
  } catch (err) {
    return appError(err);
  }
}
