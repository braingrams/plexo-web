import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { getTierFeatures } from "@/lib/subscription";
import { compileDesignJsonForKind } from "@/lib/compileForKind";
import { isValidUuid } from "@/server/slugDynamo";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

type ConvertTypeBody = {
  targetKind?: "EMAIL" | "LANDING_PAGE";
};

/**
 * POST /api/templates/:id/convert-type
 *
 * Flips an existing BUILDER template's kind (EMAIL <-> LANDING_PAGE) and recompiles
 * compiledHtml for the new target — designJson itself is untouched, same block tree, just
 * relabeled. No `confirm` flag: same shape as reset-to-builder/route.ts, where confirming a
 * one-way action with the user is entirely the client's job before calling this.
 *
 * `kind` isn't part of Template's primary key composite (contentEntities.ts: pk is just
 * `id`), so this is a plain in-place `.patch().set()` — no create-at-new-key dance needed.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }

  const body = (await request.json().catch(() => ({}))) as ConvertTypeBody;
  const targetKind = body.targetKind === "EMAIL" || body.targetKind === "LANDING_PAGE" ? body.targetKind : null;
  if (!targetKind) {
    return NextResponse.json({ error: "targetKind must be 'EMAIL' or 'LANDING_PAGE'." }, { status: 400 });
  }

  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  if (existing.kind === targetKind) {
    return NextResponse.json({ error: `This page is already ${targetKind === "EMAIL" ? "an email template" : "a landing page"}.` }, { status: 400 });
  }
  if (existing.sourceType !== "BUILDER") {
    return NextResponse.json({ error: "Raw HTML pages can't be converted directly. Switch to Builder first." }, { status: 400 });
  }
  if (existing.parentId) {
    return NextResponse.json({ error: "Sub-pages always match their parent page's type and can't be converted independently." }, { status: 400 });
  }
  if (existing.isBlogLayout) {
    return NextResponse.json({ error: "Blog layout templates can't be converted — they're always a landing page layout referenced by a blog site." }, { status: 400 });
  }

  const features = getTierFeatures(resolved.subscriptionPlan);

  const { data: pageCount } = await Template.query.byParent({ parentId: existing.id }).go();

  if (targetKind === "EMAIL") {
    if (pageCount.length > 0) {
      return NextResponse.json(
        { error: `This page has ${pageCount.length} sub-page(s). Remove them before converting it to an email template.` },
        { status: 400 },
      );
    }
    const { data: domains } = await PublishedDomain.query.primary({ templateId: existing.id }).go();
    if (domains[0]) {
      return NextResponse.json(
        { error: "Unlink this page's published domain before converting it to an email template." },
        { status: 400 },
      );
    }
    const { data: orgRoots } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const emailCount = orgRoots.filter((t) => !t.parentId && t.kind === "EMAIL" && !t.isBlogLayout && !t.isCommerceLayout).length;
    if (emailCount >= features.maxEmailTemplates) {
      return NextResponse.json(
        { error: `Your plan allows a maximum of ${features.maxEmailTemplates} email templates. Upgrade to convert more.`, plan: resolved.subscriptionPlan },
        { status: 403 },
      );
    }
  } else {
    const { data: orgRoots } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const landingPageCount = orgRoots.filter((t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.isBlogLayout && !t.isCommerceLayout).length;
    if (landingPageCount >= features.maxLandingPages) {
      return NextResponse.json(
        { error: `Your plan allows a maximum of ${features.maxLandingPages} landing pages. Upgrade to convert more.`, plan: resolved.subscriptionPlan },
        { status: 403 },
      );
    }
  }

  const compiledHtml = await compileDesignJsonForKind(existing.designJson, targetKind);

  await Template.patch({ id: existing.id }).set({ kind: targetKind, compiledHtml }).go();
  const { data: updated } = await Template.get({ id: existing.id }).go();
  if (!updated) throw new Error(`Template ${existing.id} vanished immediately after being updated`);

  return NextResponse.json({ template: { id: updated.id, name: updated.name, kind: updated.kind, updatedAt: updated.updatedAt } });
}
