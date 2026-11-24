import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { Member } from "@/lib/db/coreEntities";
import { Template } from "@/lib/db/contentEntities";
import { workspaceOwner, planFromOwner } from "@/lib/plan/workspacePlan";
import { getTierFeatures, siteBadgeChoice, siteFlagFromChoice, type SiteBadgeChoice } from "@/lib/subscription";
import { planGateBody } from "@/lib/plan/planGate";
import { purgeSitePagesInBackground } from "@/lib/pub/edgeCache";

/**
 * GET/PUT /api/v1/templates/[id]/badge   ([id] is the site's home page)
 *
 * The "Hosted with Plexo" badge for this one site: follow the account setting, always show it, or always hide it. The site's own choice
 * wins over the account's. Hiding it comes with the Starter plan and above, whichever level asks.
 */
async function loadSite(request: NextRequest, id: string) {
  const resolved = await resolveUser(request);
  if (!resolved) return { ok: false, error: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) } as const;
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) return { ok: false, error: NextResponse.json({ error: "Site not found." }, { status: 404 }) } as const;
  return { ok: true, resolved, site } as const;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const r = await loadSite(request, id);
  if (!r.ok) return r.error;
  const owner = await workspaceOwner(r.resolved.organizationId);
  return NextResponse.json({ choice: siteBadgeChoice(r.site.hideBranding), accountHides: !!owner?.hideBranding, planAllowsHiding: getTierFeatures(planFromOwner(owner).subscriptionPlan).brandingRemovalEnabled });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const r = await loadSite(request, id);
  if (!r.ok) return r.error;
  const { resolved, site } = r;
  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;
  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }
  const body = (await request.json().catch(() => ({}))) as { choice?: unknown };
  const choice = body.choice;
  if (choice !== "account" && choice !== "show" && choice !== "hide") return NextResponse.json({ error: "Choose follow my account, show, or hide." }, { status: 400 });
  if (choice === "hide") {
    const owner = await workspaceOwner(resolved.organizationId);
    if (!getTierFeatures(planFromOwner(owner).subscriptionPlan).brandingRemovalEnabled) {
      return NextResponse.json(planGateBody("PLAN_BRANDING", "Removing the Plexo badge comes with the Starter plan and above."), { status: 403 });
    }
  }
  const flag = siteFlagFromChoice(choice as SiteBadgeChoice);
  if (flag === null) await Template.patch({ id }).remove(["hideBranding"]).go();
  else await Template.patch({ id }).set({ hideBranding: flag }).go();
  // So the change shows within seconds rather than waiting for the page cache (best effort; it expires within a minute anyway).
  purgeSitePagesInBackground(id);
  return NextResponse.json({ choice });
}
