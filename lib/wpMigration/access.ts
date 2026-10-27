import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getTierFeatures } from "@/lib/subscription";
import { isValidUuid } from "@/lib/slugUtils";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { Template } from "@/lib/db/contentEntities";
import type { OrgRole } from "@/server/accessControl";

export interface MigrationAccess {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  subscriptionPlan: string;
}

// A migration builds a multi-page site — the same plan gate as Site Import (and for the
// same security reason: the detect step fetches arbitrary URLs server-side, so it must not
// be a free fetch proxy for accounts that can't use the result). The message tells the
// owner exactly what unlocks it rather than a bare 403.
export const MIGRATION_PLAN_MESSAGE = "Moving a whole WordPress site to Plexo is part of the Pro and Ultra plans. Upgrade in Settings → Billing to continue.";

export async function resolveMigrationAccess(
  request: NextRequest,
  opts: { permission: "create" | "update" },
): Promise<{ access: MigrationAccess } | { error: NextResponse }> {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) };
  const permissionError = requirePermission(resolved.role, { template: [opts.permission] });
  if (permissionError) return { error: permissionError };
  if (!getTierFeatures(resolved.subscriptionPlan).siteMigrationEnabled) {
    return { error: NextResponse.json({ error: MIGRATION_PLAN_MESSAGE, requiresUpgrade: true }, { status: 403 }) };
  }
  return {
    access: { userId: resolved.userId, organizationId: resolved.organizationId, role: resolved.role, subscriptionPlan: resolved.subscriptionPlan },
  };
}

/** Confirms templateId is a root site owned by the caller's organization. */
export async function assertOwnSite(access: MigrationAccess, templateId: string): Promise<NextResponse | null> {
  if (!isValidUuid(templateId)) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  const { data: site } = await Template.get({ id: templateId }).go();
  if (!site || site.organizationId !== access.organizationId || site.parentId) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  return null;
}
