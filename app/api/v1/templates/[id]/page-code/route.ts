import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { Member } from "@/lib/db/coreEntities";
import { readPageCode, savePageCode } from "@/lib/customCode/pageCode";

/** GET: the code saved for this one page, and whether the owner's plan allows it. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const state = await readPageCode(resolved.organizationId, id);
  if (!state) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  return NextResponse.json(state);
}

/** PUT { head?, footer? }: save the page's own code. It is checked first; "" clears it. */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;
  const { id } = await context.params;
  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }
  const body = (await request.json().catch(() => ({}))) as { head?: unknown; footer?: unknown };
  const r = await savePageCode({ organizationId: resolved.organizationId, pageId: id, userId: resolved.userId, head: body.head, footer: body.footer });
  if (!r.ok) return NextResponse.json({ error: r.error, ...(r.planGate ? { planGate: true } : {}) }, { status: r.status });
  return NextResponse.json(r.state);
}
