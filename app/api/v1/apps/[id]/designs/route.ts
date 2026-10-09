import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { listDesigns, saveDesign, slugForName, DesignConflictError } from "@/lib/projects/designs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The app's visual designs (the editor's Design tab — lib/projects/designs.ts).
 *   GET  → { designs: [{ slug, name, route, codeEdited, … }], brand }
 *   POST { name, route, nodes, pageOrder, brand? } → creates a design (a new page) and its code
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  try {
    return NextResponse.json(await listDesigns(id));
  } catch (err) {
    return appError(err);
  }
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    const { designs } = await listDesigns(id);
    const slug = slugForName(String(body.name ?? "Page"), designs.map((d) => d.slug));
    const saved = await saveDesign(id, slug, { name: body.name, route: body.route, nodes: body.nodes, pageOrder: body.pageOrder, brand: body.brand }, loaded.resolved.userId);
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    if (err instanceof DesignConflictError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    return appError(err);
  }
}
