import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { ensureUniqueSlug, isValidUuid } from "@/server/slug";
import { getTierFeatures } from "@/lib/subscription";

/**
 * POST /api/templates/:id/duplicate
 *
 * Clones a page's design into a new sibling under the same parent — the
 * Pages panel's "Duplicate" quick action, handy for building several
 * similar pages (e.g. multiple product pages) without starting blank.
 * Only meaningful for sub-pages; the home page (parentId null) can't be
 * duplicated this way since a domain can only link to one home page.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!getTierFeatures(resolved.subscriptionPlan).multiPageSitesEnabled) {
    return NextResponse.json(
      { error: "Multi-page sites require an Ultra subscription plan.", plan: resolved.subscriptionPlan },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  const existing = await prisma.template.findFirst({
    where: { id, userId: resolved.userId },
    select: { id: true, name: true, kind: true, parentId: true, slug: true, designJson: true, compiledHtml: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  if (!existing.parentId) {
    return NextResponse.json({ error: "The home page can't be duplicated from here." }, { status: 400 });
  }

  const lastSibling = await prisma.template.findFirst({
    where: { parentId: existing.parentId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const name = `${existing.name} copy`;
  const slug = await ensureUniqueSlug(existing.parentId, `${existing.slug ?? name}-copy`);

  const duplicate = await prisma.template.create({
    data: {
      userId: resolved.userId,
      name,
      kind: existing.kind,
      parentId: existing.parentId,
      slug,
      order: (lastSibling?.order ?? -1) + 1,
      designJson: existing.designJson as Prisma.InputJsonValue,
      compiledHtml: existing.compiledHtml,
    },
    select: { id: true, name: true, slug: true, parentId: true, order: true },
  });

  return NextResponse.json({ page: duplicate }, { status: 201 });
}
