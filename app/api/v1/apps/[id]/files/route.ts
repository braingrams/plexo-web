import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { listFiles, readFiles, writeFiles, editFile, deleteFiles, type FileWrite } from "@/lib/projects/fileStore";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The app's working copy (Code Mode, SOL, the Deploy API). Saving here never spends AI
 * credits. Changes become a version when the app is built or a version is saved.
 *   GET    → { files: [{ path, size, contentType }] }; with ?paths=a,b → their contents
 *   PUT    { files: [{ path, content | base64 }] } → create/overwrite
 *   PATCH  { path, edits: [{ find, replace, all? }] } → targeted edits
 *   DELETE { paths } → delete files (a folder path deletes everything under it)
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  try {
    const paths = request.nextUrl.searchParams.get("paths");
    if (paths) {
      const list = paths.split(",").map((p) => p.trim()).filter(Boolean).slice(0, 100);
      return NextResponse.json(await readFiles(id, list));
    }
    const files = await listFiles(id);
    return NextResponse.json({ files: files.map(({ path, size, contentType, sha }) => ({ path, size, contentType, sha })) });
  } catch (err) {
    return appError(err);
  }
}

export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    const files = await writeFiles(id, (body.files ?? []) as FileWrite[], loaded.resolved.userId);
    return NextResponse.json({ files });
  } catch (err) {
    return appError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    const file = await editFile(id, String(body.path ?? ""), body.edits ?? [], loaded.resolved.userId);
    return NextResponse.json({ file });
  } catch (err) {
    return appError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    if (!Array.isArray(body.paths) || !body.paths.length) return NextResponse.json({ error: "Pass the paths to delete." }, { status: 400 });
    return NextResponse.json({ deleted: await deleteFiles(id, body.paths) });
  } catch (err) {
    return appError(err);
  }
}
