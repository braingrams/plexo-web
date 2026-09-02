import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/authDynamo";
import { Member, Organization } from "@/lib/db/coreEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { canWhiteLabel } from "@/lib/subscription";
import { getOrganizationOwnerPlanDynamo } from "@/server/orgDynamo";
import { isValidHexColor } from "@/lib/color";
import type { OrgRole } from "@/server/accessControl";

async function getMembership(organizationId: string): Promise<{ userId: string; role: OrgRole } | null> {
  const session = await auth();
  if (!session?.user) return null;
  const { data: membership } = await Member.get({ organizationId, userId: session.user.id }).go();
  if (!membership) return null;
  return { userId: session.user.id, role: membership.role as OrgRole };
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
 * Gated to Pro/Ultra via canWhiteLabel(getOrganizationOwnerPlanDynamo(id)) — see
 * lib/subscription.ts for why plan is resolved via the owning Member rather than a column
 * on Organization itself (billing still lives entirely on User).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const membership = await getMembership(id);
  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: org } = await Organization.get({ id }).go();
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const plan = await getOrganizationOwnerPlanDynamo(id);
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
  const membership = await getMembership(id);
  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(membership.role, { organization: ["update"] });
  if (permissionError) return permissionError;

  const plan = await getOrganizationOwnerPlanDynamo(id);
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

  const data: { name?: string; logo?: string; brandColor?: string; whiteLabelEnabled?: boolean } = {};
  const toRemove: ("logo" | "brandColor")[] = [];

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Organization name cannot be empty." }, { status: 400 });
    }
    data.name = trimmed;
  }

  if (body.logo === null || typeof body.logo === "string") {
    const trimmed = typeof body.logo === "string" ? body.logo.trim() : "";
    if (trimmed) data.logo = trimmed;
    else toRemove.push("logo");
  }

  if (body.brandColor === null || typeof body.brandColor === "string") {
    const trimmed = typeof body.brandColor === "string" ? body.brandColor.trim() : "";
    if (trimmed && !isValidHexColor(trimmed)) {
      return NextResponse.json({ error: "brandColor must be a 6-digit hex color, e.g. #4f46e5." }, { status: 400 });
    }
    if (trimmed) data.brandColor = trimmed;
    else toRemove.push("brandColor");
  }

  if (typeof body.whiteLabelEnabled === "boolean") {
    data.whiteLabelEnabled = body.whiteLabelEnabled;
  }

  let patch = Organization.patch({ id }).set(data);
  if (toRemove.length) patch = patch.remove(toRemove);
  await patch.go();

  const { data: updated } = await Organization.get({ id }).go();
  if (!updated) throw new Error(`Organization ${id} vanished immediately after being updated`);

  return NextResponse.json({
    name: updated.name,
    logo: updated.logo,
    brandColor: updated.brandColor,
    whiteLabelEnabled: updated.whiteLabelEnabled,
    planAllowsWhiteLabel: true,
  });
}
