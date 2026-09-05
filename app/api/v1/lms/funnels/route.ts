import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { Template, LmsFunnel, LmsPage } from "@/lib/db/contentEntities";
import { getAvailableFunnelSlots } from "@/lib/lms/funnelSlots";
import { defaultUnlockRules } from "@/lib/lms/rules";
import { compileFunnelStarterDesign } from "@/lib/lms/funnelStarterDesign";

/**
 * GET  /api/v1/lms/funnels — this org's funnels + slot summary, for the /dashboard/funnels
 * dispatcher (empty state vs redirect-to-most-recent) and the "buy another slot" upsell.
 * POST /api/v1/lms/funnels — attaches Funnel capability to an EXISTING root Template (the
 * admin already picked/duplicated one via the normal template-creation flow) and seeds a
 * single auto-created Welcome page — mirrors app/api/templates/route.ts's own plan-gating
 * shape, but the resource being gated is a funnel slot (lib/lms/funnelSlots.ts), not a raw
 * template count.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ data: funnels }, slots] = await Promise.all([
    LmsFunnel.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" }),
    getAvailableFunnelSlots(resolved.organizationId, resolved.subscriptionPlan),
  ]);

  funnels.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return NextResponse.json({ funnels, slots });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { lms: ["create"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { templateId?: string };
  const templateId = body.templateId?.trim();
  if (!templateId) {
    return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  }

  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId || template.parentId) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }

  const { data: existing } = await LmsFunnel.get({ templateId }).go();
  if (existing) {
    return NextResponse.json({ error: "This site is already a funnel." }, { status: 409 });
  }

  const slots = await getAvailableFunnelSlots(resolved.organizationId, resolved.subscriptionPlan);
  if (!slots.hasSlotAvailable) {
    return NextResponse.json(
      {
        error: "You've used every funnel slot your plan includes. Buy another slot to create more.",
        slots,
      },
      { status: 403 },
    );
  }

  const funnelId = randomUUID();
  // A brand-new funnel's page is never truly blank — it starts pre-seeded with a working
  // signup form (see funnelStarterDesign.ts), the same "don't make the owner design
  // something before it works" philosophy as Commerce's ensureProductDetailLayout. The
  // admin can freely rearrange/restyle it afterward; the one thing that keeps it working is
  // the data-plexo-lms-signup marker itself, which Funnel Settings can always hand out
  // again ("Embed your signup form") if it's ever removed.
  const { designJson, compiledHtml } = await compileFunnelStarterDesign(template.name, templateId);
  await Promise.all([
    LmsFunnel.create({
      id: funnelId,
      templateId,
      organizationId: resolved.organizationId,
      userId: resolved.userId,
    }).go(),
    // Labels this site as a Funnel in /dashboard/templates (filterable, badged) without
    // excluding it from that list the way isCommerceLayout/isBlogLayout do — a funnel is
    // still an ordinary site there.
    Template.patch({ id: templateId }).set({ isLmsFunnel: true, designJson, compiledHtml }).go(),
  ]);

  // Seed a single Welcome page so "New Funnel" always lands on something real rather than
  // an empty list — the zero-to-first-value path only needs one page + flipping "enabled".
  await LmsPage.create({
    id: randomUUID(),
    templateId,
    organizationId: resolved.organizationId,
    order: 0,
    kind: "WELCOME",
    title: "Welcome",
    // Despite the field's name, WELCOME pages render bodyHtml as plain escaped text
    // everywhere (the admin textarea and the learner portal both treat it as plain text,
    // not markup — see lib/lms/rules.ts's module comment and PortalClient.tsx's
    // `white-space: pre-wrap` rendering) — literal HTML here would show its own tags
    // verbatim to a real visitor, not render as formatting.
    bodyHtml: "Welcome! We're glad you're here.",
    unlockRules: defaultUnlockRules(null),
  }).go();

  return NextResponse.json({ funnel: (await LmsFunnel.get({ templateId }).go()).data }, { status: 201 });
}
