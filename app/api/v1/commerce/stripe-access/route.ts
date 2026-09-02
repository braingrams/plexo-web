import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { sendCommerceStripeAccessRequestNotificationEmail } from "@/lib/email";
import { Organization, User } from "@/lib/db/coreEntities";
import { CommerceStripeAccessRequest } from "@/lib/db/commerceEntities";

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

  const { data: requests } = await CommerceStripeAccessRequest.query.primary({ organizationId: resolved.organizationId }).go({ order: "desc" });
  const latest = requests[0];

  if (!latest) {
    return NextResponse.json({ status: "NONE" satisfies CommerceStripeAccessStatus, requestId: null, rejectionReason: null, reason: null });
  }

  return NextResponse.json({
    status: (latest.status ?? "PENDING") satisfies CommerceStripeAccessStatus,
    requestId: latest.id,
    rejectionReason: latest.status === "REJECTED" ? (latest.rejectionReason ?? null) : null,
    reason: latest.reason ?? null,
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

  const permissionError = requirePermission(resolved.role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const [{ data: organization }, { data: user }] = await Promise.all([
    Organization.get({ id: resolved.organizationId }).go(),
    User.get({ id: resolved.userId }).go(),
  ]);
  if (!organization || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: existingRequests } = await CommerceStripeAccessRequest.query.primary({ organizationId: resolved.organizationId }).go();
  const blocking = existingRequests.some((r) => r.status === "PENDING" || r.status === "APPROVED");
  if (blocking) {
    return NextResponse.json(
      { error: "A Stripe access request is already pending or approved for this organization." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as { reason?: string; expectedVolume?: string } | null;
  const reason = body?.reason?.trim() || undefined;
  const expectedVolume = body?.expectedVolume?.trim() || undefined;

  const id = randomUUID();
  await CommerceStripeAccessRequest.create({
    id,
    organizationId: resolved.organizationId,
    requestedByUserId: resolved.userId,
    reason,
    expectedVolume,
  }).go();

  await sendCommerceStripeAccessRequestNotificationEmail({
    id,
    organizationName: organization.name,
    userEmail: user.email,
    userName: user.name ?? "A user",
    reason: reason ?? null,
    expectedVolume: expectedVolume ?? null,
  }).catch((err) => console.error("Failed to send Commerce Stripe access admin notification email:", err));

  return NextResponse.json({ request: { id, status: "PENDING" } }, { status: 201 });
}
