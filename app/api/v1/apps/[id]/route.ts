import { NextRequest, NextResponse } from "next/server";
import { Template } from "@/lib/db/contentEntities";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { appSummary } from "@/lib/projects/summary";
import { deleteTemplateAndContents, SiteDeletionBlockedError } from "@/lib/sites/deleteTemplate";

type Ctx = { params: Promise<{ id: string }> };

/** GET: the app at a glance. PATCH { name }: rename. DELETE: delete the app and everything it owns. */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  return NextResponse.json(await appSummary(loaded.app));
}

export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) return NextResponse.json({ error: "Give the app a name." }, { status: 400 });
    await Template.patch({ id }).set({ name }).go();
    return NextResponse.json(await appSummary({ ...loaded.app, name }));
  } catch (err) {
    return appError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "delete");
  if (loaded instanceof NextResponse) return loaded;
  try {
    await deleteTemplateAndContents(loaded.app, loaded.resolved.organizationId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof SiteDeletionBlockedError) return NextResponse.json({ error: err.message }, { status: 409 });
    return appError(err);
  }
}
