import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { recentBuilds } from "@/lib/projects/builds";
import { startPreview } from "@/lib/projects/pipeline";

type Ctx = { params: Promise<{ id: string }> };

/** GET: recent builds. POST { message? }: save changes as a version and build the preview;
 * returns { buildId } right away — poll GET /builds/<buildId> for the result. */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const builds = await recentBuilds(id, Math.min(Number(request.nextUrl.searchParams.get("limit")) || 20, 100));
  return NextResponse.json({
    builds: builds.map((b) => ({ id: b.id, versionId: b.versionId, mode: b.mode, status: b.status, summary: b.summary ?? null, createdAt: b.createdAt, finishedAt: b.finishedAt ?? null, durationMs: b.durationMs ?? null })),
  });
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request).catch(() => ({}) as Record<string, any>);
    const build = await startPreview(id, loaded.actor, { message: typeof body.message === "string" ? body.message : undefined });
    return NextResponse.json({ buildId: build.id, versionId: build.versionId }, { status: 202 });
  } catch (err) {
    return appError(err);
  }
}
