import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { startPublish } from "@/lib/projects/pipeline";

/**
 * POST { subdomain? } — publishes the latest changes: a clean release build, then the live
 * database gets any new migrations, server functions are deployed, and the live site
 * switches over. The first publish picks an address from the app's name unless one is given.
 * Returns { buildId } right away — poll GET /builds/<buildId> for liveUrl.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "publish");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request).catch(() => ({}) as Record<string, any>);
    const build = await startPublish(id, loaded.actor, { subdomain: typeof body.subdomain === "string" ? body.subdomain : undefined });
    return NextResponse.json({ buildId: build.id, versionId: build.versionId }, { status: 202 });
  } catch (err) {
    return appError(err);
  }
}
