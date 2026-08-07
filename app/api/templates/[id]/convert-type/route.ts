import { NextRequest, NextResponse } from "next/server";
import { TemplateKind } from "@prisma/client";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { getTierFeatures } from "@/lib/subscription";
import { compileDesignJsonForKind } from "@/lib/compileForKind";
import { isValidUuid } from "@/server/slug";

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
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as ConvertTypeBody;
  const targetKind = body.targetKind === "EMAIL" || body.targetKind === "LANDING_PAGE" ? body.targetKind : null;
  if (!targetKind) {
    return NextResponse.json({ error: "targetKind must be 'EMAIL' or 'LANDING_PAGE'." }, { status: 400 });
  }

  const existing = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: {
      id: true,
      kind: true,
      sourceType: true,
      parentId: true,
      isBlogLayout: true,
      designJson: true,
      _count: { select: { pages: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  if (existing.kind === targetKind) {
    return NextResponse.json({ error: `This page is already ${targetKind === "EMAIL" ? "an email template" : "a landing page"}.` }, { status: 400 });
  }
  if (existing.sourceType !== "BUILDER") {
    return NextResponse.json({ error: "Raw HTML pages can't be converted directly. Switch to Builder first." }, { status: 400 });
  }
  if (existing.parentId !== null) {
    return NextResponse.json({ error: "Sub-pages always match their parent page's type and can't be converted independently." }, { status: 400 });
  }
  if (existing.isBlogLayout) {
    return NextResponse.json({ error: "Blog layout templates can't be converted — they're always a landing page layout referenced by a blog site." }, { status: 400 });
  }

  const features = getTierFeatures(resolved.subscriptionPlan);

  if (targetKind === TemplateKind.EMAIL) {
    if (existing._count.pages > 0) {
      return NextResponse.json(
        { error: `This page has ${existing._count.pages} sub-page(s). Remove them before converting it to an email template.` },
        { status: 400 },
      );
    }
    const activeDomain = await prisma.publishedDomain.findFirst({ where: { templateId: existing.id } });
    if (activeDomain) {
      return NextResponse.json(
        { error: "Unlink this page's published domain before converting it to an email template." },
        { status: 400 },
      );
    }
    const emailCount = await prisma.template.count({
      where: { organizationId: resolved.organizationId, parentId: null, kind: TemplateKind.EMAIL, isBlogLayout: false },
    });
    if (emailCount >= features.maxEmailTemplates) {
      return NextResponse.json(
        { error: `Your plan allows a maximum of ${features.maxEmailTemplates} email templates. Upgrade to convert more.`, plan: resolved.subscriptionPlan },
        { status: 403 },
      );
    }
  } else {
    const landingPageCount = await prisma.template.count({
      where: { organizationId: resolved.organizationId, parentId: null, kind: TemplateKind.LANDING_PAGE, isBlogLayout: false },
    });
    if (landingPageCount >= features.maxLandingPages) {
      return NextResponse.json(
        { error: `Your plan allows a maximum of ${features.maxLandingPages} landing pages. Upgrade to convert more.`, plan: resolved.subscriptionPlan },
        { status: 403 },
      );
    }
  }

  const compiledHtml = await compileDesignJsonForKind(existing.designJson, targetKind);

  const updated = await prisma.template.update({
    where: { id: existing.id },
    data: { kind: targetKind, compiledHtml },
    select: { id: true, name: true, kind: true, updatedAt: true },
  });

  return NextResponse.json({ template: updated });
}
