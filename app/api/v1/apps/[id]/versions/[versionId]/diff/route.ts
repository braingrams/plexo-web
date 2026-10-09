import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError } from "@/lib/projects/appAccess";
import { getVersionManifest, listFiles, diffManifests, readFiles } from "@/lib/projects/fileStore";
import { getBlob } from "@/lib/projects/blobStore";
import { isTextContentType } from "@/lib/projects/paths";
import type { ProjectFileEntry } from "@/lib/db/projectEntities";

/**
 * GET ?against=<versionId>|working [&path=<file>]
 * What changed between two versions (default: this version vs the one before it is the
 * caller's to pick; "working" = the current working copy). With path, also returns that
 * file's before/after text for a side-by-side diff (the editor's "Changes" view).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }): Promise<NextResponse> {
  const { id, versionId } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  try {
    const against = request.nextUrl.searchParams.get("against") ?? "working";
    const path = request.nextUrl.searchParams.get("path");
    const before = (await getVersionManifest(id, versionId)).files;
    const after: ProjectFileEntry[] = against === "working" ? await listFiles(id) : (await getVersionManifest(id, against)).files;
    const diff = diffManifests(before, after);
    if (!path) return NextResponse.json({ diff });

    const text = async (entries: ProjectFileEntry[], isWorking: boolean) => {
      const entry = entries.find((f) => f.path === path);
      if (!entry) return null;
      if (!isTextContentType(entry.contentType)) return { binary: true, size: entry.size };
      if (isWorking) return { content: (await readFiles(id, [path])).files[0]?.content ?? "" };
      return { content: (await getBlob(id, entry.sha)).toString("utf8") };
    };
    return NextResponse.json({ diff, path, before: await text(before, false), after: await text(after, against === "working") });
  } catch (err) {
    return appError(err);
  }
}
