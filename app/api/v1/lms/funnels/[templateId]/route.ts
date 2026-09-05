import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";
import { LmsFunnel } from "@/lib/db/contentEntities";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: funnel } = await LmsFunnel.get({ templateId }).go();
  if (!funnel) return NextResponse.json({ error: "Funnel not found." }, { status: 404 });

  return NextResponse.json({ funnel });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    signupMode?: "FREE" | "PAID";
    signupProductId?: string | null;
    requireName?: boolean;
    collectPhone?: boolean;
    welcomeRedirectPath?: string | null;
  };

  const { data: existing } = await LmsFunnel.get({ templateId }).go();
  if (!existing) return NextResponse.json({ error: "Funnel not found." }, { status: 404 });

  if (body.signupMode === "PAID" && !body.signupProductId && !existing.signupProductId) {
    return NextResponse.json({ error: "Select a product to charge for signup before switching to Paid." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.signupMode === "FREE" || body.signupMode === "PAID") patch.signupMode = body.signupMode;
  if (body.signupProductId !== undefined) patch.signupProductId = body.signupProductId ?? undefined;
  if (typeof body.requireName === "boolean") patch.requireName = body.requireName;
  if (typeof body.collectPhone === "boolean") patch.collectPhone = body.collectPhone;
  if (body.welcomeRedirectPath !== undefined) patch.welcomeRedirectPath = body.welcomeRedirectPath ?? undefined;

  if (Object.keys(patch).length > 0) {
    await LmsFunnel.patch({ templateId }).set(patch).go();
  }

  const { data: funnel } = await LmsFunnel.get({ templateId }).go();
  return NextResponse.json({ funnel });
}

// Soft-delete only — disables the funnel (hidden from visitors) without destroying pages,
// enrollments, or progress, same discipline as slot deactivation (lib/lms/funnelSlots.ts).
export async function DELETE(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["delete"] });
  if (permissionError) return permissionError;

  await LmsFunnel.patch({ templateId }).set({ enabled: false }).go();
  return NextResponse.json({ success: true });
}
