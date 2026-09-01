import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { sendCommerceStripeAccessRequestNotificationEmail } from "@/lib/email";

type CommerceStripeAccessStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

/**
 * GET /api/v1/commerce/stripe-access
 *
 * Reports the org's current standing to use PLATFORM_STRIPE for Commerce checkout — org
 * scoped (not per-site), since it's Plexo's own Stripe account being requested, not a
 * per-site setting. See CommerceStripeAccessRequest in prisma/schema.prisma and the
 * approve/reject routes in plexo-admin.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const latest = await prisma.commerceStripeAccessRequest.findFirst({
    where: { organizationId: resolved.organizationId },
    orderBy: { requestedAt: "desc" },
  });

  if (!latest) {
    return NextResponse.json({ status: "NONE" satisfies CommerceStripeAccessStatus, requestId: null, rejectionReason: null, reason: null });
  }

  return NextResponse.json({
    status: latest.status satisfies CommerceStripeAccessStatus,
    requestId: latest.id,
    rejectionReason: latest.status === "REJECTED" ? latest.rejectionReason : null,
    reason: latest.reason,
  });
}

/**
 * POST /api/v1/commerce/stripe-access
 *
 * Requests staff approval to route Commerce checkout through Plexo's own platform Stripe
 * account (international payments). Approve/reject happens in plexo-admin, same split as
 * ScriptAccessRequest/WithdrawalRequest.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const [organization, user] = await Promise.all([
    prisma.organization.findUnique({ where: { id: resolved.organizationId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: resolved.userId }, select: { email: true, name: true } }),
  ]);
  if (!organization || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const blocking = await prisma.commerceStripeAccessRequest.findFirst({
    where: { organizationId: resolved.organizationId, OR: [{ status: "PENDING" }, { status: "APPROVED" }] },
  });
  if (blocking) {
    return NextResponse.json(
      { error: "A Stripe access request is already pending or approved for this organization." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as { reason?: string; expectedVolume?: string } | null;
  const reason = body?.reason?.trim() || null;
  const expectedVolume = body?.expectedVolume?.trim() || null;

  const created = await prisma.commerceStripeAccessRequest.create({
    data: { organizationId: resolved.organizationId, requestedByUserId: resolved.userId, reason, expectedVolume },
  });

  await sendCommerceStripeAccessRequestNotificationEmail({
    id: created.id,
    organizationName: organization.name,
    userEmail: user.email,
    userName: user.name,
    reason,
    expectedVolume,
  }).catch((err) => console.error("Failed to send Commerce Stripe access admin notification email:", err));

  return NextResponse.json({ request: { id: created.id, status: created.status, requestedAt: created.requestedAt } }, { status: 201 });
}
