import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { sendScriptAccessRequestNotificationEmail } from "@/lib/email";
import { Template, ScriptAccessRequest } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";

type ScriptAccessStatus = "NONE" | "PENDING" | "APPROVED_ACTIVE" | "APPROVED_EXPIRED" | "REJECTED";

/**
 * Latest-by-requestedAt for this template. ScriptAccessRequest's primary index is scoped
 * by templateId with `id` as the sort key (contentEntities.ts) — not requestedAt — so
 * there's no indexed "most recent" query; this is a plain partition query (bounded to
 * however many requests one template has ever made, not a table-wide scan) picking the
 * max by requestedAt in memory.
 */
async function latestRequestFor(templateId: string) {
  const { data: requests } = await ScriptAccessRequest.query.primary({ templateId }).go();
  if (requests.length === 0) return null;
  return requests.reduce((latest, r) => ((r.requestedAt ?? "") > (latest.requestedAt ?? "") ? r : latest));
}

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
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId || template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ status: "NONE" satisfies ScriptAccessStatus, requestId: null, remainingSeconds: null, rejectionReason: null, reason: null });
  }

  const latest = await latestRequestFor(id);

  if (!latest) {
    return NextResponse.json({ status: "NONE" satisfies ScriptAccessStatus, requestId: null, remainingSeconds: null, rejectionReason: null, reason: null });
  }

  if (latest.status === "PENDING") {
    return NextResponse.json({
      status: "PENDING" satisfies ScriptAccessStatus,
      requestId: latest.id,
      remainingSeconds: null,
      rejectionReason: null,
      reason: latest.reason ?? null,
    });
  }

  if (latest.status === "REJECTED") {
    return NextResponse.json({
      status: "REJECTED" satisfies ScriptAccessStatus,
      requestId: latest.id,
      remainingSeconds: null,
      rejectionReason: latest.rejectionReason ?? null,
      reason: latest.reason ?? null,
    });
  }

  // status === "APPROVED" — active iff still within the granted window.
  const remainingMs = latest.expiresAt ? new Date(latest.expiresAt).getTime() - Date.now() : -1;
  if (remainingMs > 0) {
    return NextResponse.json({
      status: "APPROVED_ACTIVE" satisfies ScriptAccessStatus,
      requestId: latest.id,
      remainingSeconds: Math.max(0, Math.floor(remainingMs / 1000)),
      rejectionReason: null,
      reason: latest.reason ?? null,
    });
  }

  return NextResponse.json({
    status: "APPROVED_EXPIRED" satisfies ScriptAccessStatus,
    requestId: latest.id,
    remainingSeconds: null,
    rejectionReason: null,
    reason: latest.reason ?? null,
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

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "This template was not created via raw upload." }, { status: 400 });
  }

  const { data: user } = await User.get({ id: resolved.userId }).go();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const existingRequests = await ScriptAccessRequest.query.primary({ templateId: id }).go().then((r) => r.data);
  const now = Date.now();
  const blocking = existingRequests.find(
    (r) => r.status === "PENDING" || (r.status === "APPROVED" && !!r.expiresAt && new Date(r.expiresAt).getTime() > now),
  );
  if (blocking) {
    return NextResponse.json(
      { error: "A script access request is already pending or active for this template." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = body?.reason?.trim() || undefined;

  const newId = randomUUID();
  await ScriptAccessRequest.create({ id: newId, templateId: id, userId: resolved.userId, reason }).go();
  const { data: created } = await ScriptAccessRequest.get({ templateId: id, id: newId }).go();
  if (!created) throw new Error(`ScriptAccessRequest ${newId} vanished immediately after being created`);

  await sendScriptAccessRequestNotificationEmail({
    id: created.id,
    userEmail: user.email,
    userName: user.name ?? "Plexo User",
    templateId: id,
    templateName: template.name,
    reason: reason ?? null,
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

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }

  const now = Date.now();
  const { data: requests } = await ScriptAccessRequest.query.primary({ templateId: id }).go();
  const activeCandidates = requests.filter(
    (r) => r.status === "APPROVED" && !!r.expiresAt && new Date(r.expiresAt).getTime() > now,
  );
  if (activeCandidates.length === 0) {
    return NextResponse.json({ error: "No active script access grant to end." }, { status: 400 });
  }
  const active = activeCandidates.reduce((latest, r) => ((r.requestedAt ?? "") > (latest.requestedAt ?? "") ? r : latest));

  await ScriptAccessRequest.patch({ templateId: id, id: active.id }).set({ expiresAt: new Date().toISOString() }).go();

  return NextResponse.json({ success: true });
}
