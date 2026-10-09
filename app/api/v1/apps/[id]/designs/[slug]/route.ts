import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { getDesign, saveDesign, deleteDesign, DesignConflictError } from "@/lib/projects/designs";

type Ctx = { params: Promise<{ id: string; slug: string }> };

/**
 * One visual design.
 *   GET    → { design, nodes, pageOrder, brand }
 *   PUT    { name, route, nodes, pageOrder, brand?, overwrite? } → saves and recompiles its page.
 *          409 { code: "code_edited" } when the page's code was hand-edited (resend with
 *          overwrite: true to replace it), or { code: "route_taken" }.
 *   DELETE → removes the design and its page
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id, slug } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  try {
    const design = await getDesign(id, slug);
    if (!design) return NextResponse.json({ error: "That design doesn't exist." }, { status: 404 });
    return NextResponse.json(design);
  } catch (err) {
    return appError(err);
  }
}

export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id, slug } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    return NextResponse.json(
      await saveDesign(id, slug, { name: body.name, route: body.route, nodes: body.nodes, pageOrder: body.pageOrder, brand: body.brand, overwrite: body.overwrite === true }, loaded.resolved.userId),
    );
  } catch (err) {
    if (err instanceof DesignConflictError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    return appError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id, slug } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    await deleteDesign(id, slug, loaded.resolved.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return appError(err);
  }
}
