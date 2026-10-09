import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { renameFile } from "@/lib/projects/fileStore";

/** POST { from, to } — renames or moves a file. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    await renameFile(id, String(body.from ?? ""), String(body.to ?? ""), loaded.resolved.userId);
    return NextResponse.json({ renamed: true });
  } catch (err) {
    return appError(err);
  }
}
