import { planGateResponse } from "@/lib/plan/planGateResponse";
import { PLAN } from "@/lib/plan/plans";
import { NextRequest, NextResponse } from "next/server";

import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveSiteLayoutAdmin } from "@/lib/siteLayoutDynamo";
import { readCustomCode, saveCustomCode } from "@/lib/customCode/store";

/** GET/PUT — the site's "Header code" and "Footer code" (Starter and above, custom domain only). */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;
  return NextResponse.json(await readCustomCode(resolved.context.organizationId, templateId));
}

export async function PUT(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;
  const permissionError = requirePermission(resolved.context.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { head?: unknown; footer?: unknown; onCheckout?: unknown };
  const result = await saveCustomCode({
    organizationId: resolved.context.organizationId,
    templateId,
    userId: resolved.context.userId,
    head: body.head,
    footer: body.footer,
    onCheckout: body.onCheckout,
  });
  if (!result.ok) {
    if (result.planGate) return planGateResponse("PLAN_CUSTOM_CODE", result.error, PLAN.STARTER);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.state);
}
