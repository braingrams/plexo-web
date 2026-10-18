import { NextRequest, NextResponse } from "next/server";
import { authorizeStrata, readJson, strataFail } from "@/lib/strata/server";

type Ctx = { params: Promise<{ id: string }> };

const badId = () => NextResponse.json({ error: "That Strata project wasn't found.", kind: "not_found" }, { status: 404 });
const validId = (id: string) => id.length > 0 && id.length <= 200;

/**
 * One Strata project's design system.
 *   GET → { revision?, tokens, components }
 *   PUT { variables, components, deleteVariables?, baseRevision? } → { revision?, warnings? }
 *       409 kind "conflict" when someone changed the project since baseRevision.
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!validId(id)) return badId();
  const caller = await authorizeStrata(request, "design-system", 120);
  if (caller instanceof NextResponse) return caller;
  try {
    return NextResponse.json(await caller.client.pull(id));
  } catch (err) {
    return strataFail(err);
  }
}

export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!validId(id)) return badId();
  const caller = await authorizeStrata(request, "design-system:push", 60);
  if (caller instanceof NextResponse) return caller;
  const body = await readJson(request);
  if (!body || !Array.isArray(body.variables) || !Array.isArray(body.components)) {
    return NextResponse.json({ error: "There was nothing to send to Strata. Reload the editor and try again.", kind: "invalid" }, { status: 400 });
  }
  const deleteVariables = Array.isArray(body.deleteVariables) ? body.deleteVariables.filter((k): k is string => typeof k === "string") : undefined;
  const baseRevision = typeof body.baseRevision === "string" ? body.baseRevision : undefined;
  try {
    const result = await caller.client.push(id, { variables: body.variables as never, components: body.components as never, deleteVariables }, baseRevision);
    return NextResponse.json(result);
  } catch (err) {
    return strataFail(err);
  }
}
