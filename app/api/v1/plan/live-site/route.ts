import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { Template } from "@/lib/db/contentEntities";
import { findRootTemplateId } from "@/lib/siteLayoutDynamo";
import { getTierFeatures, isHomePageOnlyPlan } from "@/lib/subscription";
import { makeSiteLive, PlanLifecycleError } from "@/lib/plan/lifecycle";

/**
 * POST /api/v1/plan/live-site { templateId }
 *
 * Free keeps one site live. This makes `templateId` that site: it goes live on its Plexo
 * address (one is created if it never had one) and the site that was live goes offline.
 * Nothing is deleted, and an upgrade brings every site back.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const permissionError = requirePermission(resolved.role, { domain: ["manage"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { templateId?: unknown };
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  const { data: page } = templateId ? await Template.get({ id: templateId }).go() : { data: null };
  if (!page || page.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }

  // Swapping the one live site is a Free-plan action (it applies Free's limits — homepage only,
  // Plexo address). Paid plans with a site limit take a site offline from its own settings instead.
  if (!isHomePageOnlyPlan(resolved.subscriptionPlan)) {
    return NextResponse.json({ error: getTierFeatures(resolved.subscriptionPlan).maxPublishedSites === null ? "Your plan keeps all your sites live already — nothing to switch." : "Take one of your live sites offline first, then put this one live." }, { status: 400 });
  }

  try {
    const rootId = await findRootTemplateId(page.id, page.parentId ?? null);
    const summary = await makeSiteLive(resolved.userId, rootId);
    return NextResponse.json({ success: true, liveAddress: summary.keptSite?.address ?? null, siteName: summary.keptSite?.name ?? null });
  } catch (err) {
    if (err instanceof PlanLifecycleError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
