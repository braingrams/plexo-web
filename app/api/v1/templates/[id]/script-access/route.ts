import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { sendScriptAccessRequestNotificationEmail } from "@/lib/email";

type ScriptAccessStatus = "NONE" | "PENDING" | "APPROVED_ACTIVE" | "APPROVED_EXPIRED" | "REJECTED";

/**
 * GET /api/v1/templates/:id/script-access
 *
 * Reports the current state of full-script preview access for this template's Text
 * Content tab — see RawTextContentEditor.tsx/ScriptAccessControl.tsx. "Expired" is derived
 * here (status == APPROVED && expiresAt <= now), not stored — see the ScriptAccessRequest
 * model comment in prisma/schema.prisma.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const template = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: { sourceType: true },
  });
  if (!template || template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ status: "NONE" satisfies ScriptAccessStatus, requestId: null, remainingSeconds: null, rejectionReason: null, reason: null });
  }

  const latest = await prisma.scriptAccessRequest.findFirst({
    where: { templateId: id },
    orderBy: { requestedAt: "desc" },
  });

  if (!latest) {
    return NextResponse.json({ status: "NONE" satisfies ScriptAccessStatus, requestId: null, remainingSeconds: null, rejectionReason: null, reason: null });
  }

  if (latest.status === "PENDING") {
    return NextResponse.json({
      status: "PENDING" satisfies ScriptAccessStatus,
      requestId: latest.id,
      remainingSeconds: null,
      rejectionReason: null,
      reason: latest.reason,
    });
  }

  if (latest.status === "REJECTED") {
    return NextResponse.json({
      status: "REJECTED" satisfies ScriptAccessStatus,
      requestId: latest.id,
      remainingSeconds: null,
      rejectionReason: latest.rejectionReason,
      reason: latest.reason,
    });
  }

  // status === "APPROVED" — active iff still within the granted window.
  const remainingMs = latest.expiresAt ? latest.expiresAt.getTime() - Date.now() : -1;
  if (remainingMs > 0) {
    return NextResponse.json({
      status: "APPROVED_ACTIVE" satisfies ScriptAccessStatus,
      requestId: latest.id,
      remainingSeconds: Math.max(0, Math.floor(remainingMs / 1000)),
      rejectionReason: null,
      reason: latest.reason,
    });
  }

  return NextResponse.json({
    status: "APPROVED_EXPIRED" satisfies ScriptAccessStatus,
    requestId: latest.id,
    remainingSeconds: null,
    rejectionReason: null,
    reason: latest.reason,
  });
}

/**
 * POST /api/v1/templates/:id/script-access
 *
 * Requests staff approval to run this RAW_UPLOAD template's uploaded JavaScript live in
 * the Text Content tab's preview. See ScriptAccessRequest in prisma/schema.prisma and the
 * approve/reject routes in plexo-admin.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const [template, user] = await Promise.all([
    prisma.template.findFirst({
      where: { id, organizationId: resolved.organizationId },
      select: { sourceType: true, name: true },
    }),
    prisma.user.findUnique({ where: { id: resolved.userId }, select: { email: true, name: true } }),
  ]);
  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "This template was not created via raw upload." }, { status: 400 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const blocking = await prisma.scriptAccessRequest.findFirst({
    where: {
      templateId: id,
      OR: [{ status: "PENDING" }, { status: "APPROVED", expiresAt: { gt: new Date() } }],
    },
  });
  if (blocking) {
    return NextResponse.json(
      { error: "A script access request is already pending or active for this template." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = body?.reason?.trim() || null;

  const created = await prisma.scriptAccessRequest.create({
    data: { templateId: id, userId: resolved.userId, reason },
  });

  await sendScriptAccessRequestNotificationEmail({
    id: created.id,
    userEmail: user.email,
    userName: user.name,
    templateId: id,
    templateName: template.name,
    reason,
  }).catch((err) => console.error("Failed to send script access admin notification email:", err));

  return NextResponse.json({ request: { id: created.id, status: created.status, requestedAt: created.requestedAt } }, { status: 201 });
}

/**
 * PATCH /api/v1/templates/:id/script-access
 *
 * Voluntarily ends the currently active grant early (sets expiresAt to now), so an editor
 * isn't stuck with click-to-scroll/highlight/live-patch paused for the rest of an approved
 * window they no longer need — see ScriptAccessControl.tsx's "End early" control. Only
 * meaningful while a request is APPROVED and still active; a no-op error otherwise.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const template = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: { id: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }

  const active = await prisma.scriptAccessRequest.findFirst({
    where: { templateId: id, status: "APPROVED", expiresAt: { gt: new Date() } },
    orderBy: { requestedAt: "desc" },
  });
  if (!active) {
    return NextResponse.json({ error: "No active script access grant to end." }, { status: 400 });
  }

  await prisma.scriptAccessRequest.update({ where: { id: active.id }, data: { expiresAt: new Date() } });

  return NextResponse.json({ success: true });
}
