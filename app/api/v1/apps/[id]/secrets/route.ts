import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { listSecrets, setSecret, deleteSecret } from "@/lib/appFunctions/secrets";

type Ctx = { params: Promise<{ id: string }> };

/** The secrets vault for the app's server functions. Values are write-only.
 *  GET → names, scopes and hints. PUT { name, value, scope? } → save. DELETE { name, scope? } → remove.
 *  Functions see changes on their next cold start (within minutes, no redeploy needed). */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  return NextResponse.json({ secrets: await listSecrets(id) });
}

export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request, 64_000);
    return NextResponse.json({ saved: await setSecret(id, { name: body.name, value: body.value, scope: body.scope }, loaded.actor.userId) });
  } catch (err) {
    return appError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request, 4_000);
    await deleteSecret(id, String(body.name ?? ""), body.scope === "dev" || body.scope === "live" ? body.scope : "all");
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return appError(err);
  }
}
