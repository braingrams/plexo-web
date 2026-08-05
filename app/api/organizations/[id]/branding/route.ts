import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { canWhiteLabel, getOrganizationOwnerPlan } from "@/lib/subscription";
import { isValidHexColor } from "@/lib/color";

async function getMembership(request: NextRequest, organizationId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const membership = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId, userId: session.user.id } },
  });
  if (!membership) return null;
  return { userId: session.user.id, role: membership.role };
}

/**
 * GET/PATCH /api/organizations/[id]/branding
 *
 * White-label config for a single organization (name/logo/brandColor/whiteLabelEnabled),
 * consumed by:
 *  - app/dashboard/settings/branding (this org's own owner/admin, gated below)
 *  - app/dashboard/dashboard-shell-{modern,classic}.tsx (dashboard chrome)
 *  - server/auth.ts + app/api/v1/comments (transactional emails)
 *  - app/pub/[domain]/[[...slug]]/route.ts (published-page favicon)
 *  - app/api/v1/validate-key (embedded SDK splash)
 *
 * Gated to Pro/Ultra via canWhiteLabel(getOrganizationOwnerPlan(id)) — see
 * lib/subscription.ts for why plan is resolved via the owning Member rather than a column
 * on Organization itself (billing still lives entirely on User).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const membership = await getMembership(request, id);
  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { name: true, logo: true, brandColor: true, whiteLabelEnabled: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const plan = await getOrganizationOwnerPlan(id);
  return NextResponse.json({
    name: org.name,
    logo: org.logo,
    brandColor: org.brandColor,
    planAllowsWhiteLabel: canWhiteLabel(plan),
    whiteLabelEnabled: org.whiteLabelEnabled,
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const membership = await getMembership(request, id);
  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, membership.role, {
    organization: ["update"],
  });
  if (permissionError) return permissionError;

  const plan = await getOrganizationOwnerPlan(id);
  if (!canWhiteLabel(plan)) {
    return NextResponse.json(
      { error: "White-labeling requires the organization owner to be on a Pro or Ultra plan." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    logo?: string | null;
    brandColor?: string | null;
    whiteLabelEnabled?: boolean;
  };

  const data: { name?: string; logo?: string | null; brandColor?: string | null; whiteLabelEnabled?: boolean } = {};

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Organization name cannot be empty." }, { status: 400 });
    }
    data.name = trimmed;
  }

  if (body.logo === null || typeof body.logo === "string") {
    data.logo = typeof body.logo === "string" ? body.logo.trim() || null : null;
  }

  if (body.brandColor === null || typeof body.brandColor === "string") {
    const trimmed = typeof body.brandColor === "string" ? body.brandColor.trim() : null;
    if (trimmed && !isValidHexColor(trimmed)) {
      return NextResponse.json({ error: "brandColor must be a 6-digit hex color, e.g. #4f46e5." }, { status: 400 });
    }
    data.brandColor = trimmed || null;
  }

  if (typeof body.whiteLabelEnabled === "boolean") {
    data.whiteLabelEnabled = body.whiteLabelEnabled;
  }

  // Writes straight to Prisma rather than auth.api.updateOrganization: better-auth's
  // additionalFields typing only accepts `string | undefined` for brandColor (no
  // `null`), so it can't express "clear the color" — and permission (organization:update)
  // plus the plan gate above are already fully enforced by this point, so there's nothing
  // better-auth's own endpoint would additionally check.
  const updated = await prisma.organization.update({
    where: { id },
    data,
    select: { name: true, logo: true, brandColor: true, whiteLabelEnabled: true },
  });

  return NextResponse.json({ ...updated, planAllowsWhiteLabel: true });
}
