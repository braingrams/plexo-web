import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError } from "@/lib/projects/appAccess";
import { restoreVersion } from "@/lib/projects/fileStore";
import { startPreview } from "@/lib/projects/pipeline";

/** POST — puts a past version back as the working copy (recorded as a new version, so it's
 * undoable too) and rebuilds the preview. The live app is untouched until the next publish. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }): Promise<NextResponse> {
  const { id, versionId } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const restored = await restoreVersion(id, versionId, { authorId: loaded.actor.userId, authorName: loaded.actor.userName });
    const build = await startPreview(id, loaded.actor).catch(() => null);
    return NextResponse.json({ versionId: restored.versionId, buildId: build?.id ?? null });
  } catch (err) {
    return appError(err);
  }
}
