import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { isValidSlugSegment, isSameOrAncestor, isValidUuid, slugify } from "@/server/slug";

type PatchTemplateBody = {
  name?: string;
  slug?: string;
  parentId?: string | null;
  order?: number;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  const existing = await prisma.template.findFirst({
    where: { id, userId: resolved.userId },
    select: { id: true, parentId: true, slug: true, kind: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchTemplateBody;
  const data: Prisma.TemplateUpdateInput = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    }
    data.name = name;
  }

  if (body.slug !== undefined) {
    if (existing.parentId === null) {
      return NextResponse.json({ error: "The home page doesn't have its own URL segment." }, { status: 400 });
    }
    const nextSlug = slugify(body.slug);
    if (!nextSlug || !isValidSlugSegment(nextSlug)) {
      return NextResponse.json({ error: "That page URL isn't valid. Use lowercase letters, numbers, and hyphens." }, { status: 400 });
    }
    data.slug = nextSlug;
  }

  let nextParentId = existing.parentId;
  if (body.parentId !== undefined) {
    if (existing.parentId === null) {
      return NextResponse.json({ error: "The home page can't be nested under another page." }, { status: 400 });
    }
    const targetParentId = body.parentId;
    if (!targetParentId) {
      return NextResponse.json({ error: "A sub-page must have a parent page." }, { status: 400 });
    }
    if (targetParentId === existing.id) {
      return NextResponse.json({ error: "A page can't be nested under itself." }, { status: 400 });
    }
    if (!isValidUuid(targetParentId)) {
      return NextResponse.json({ error: "Target page not found." }, { status: 404 });
    }
    const targetParent = await prisma.template.findFirst({
      where: { id: targetParentId, userId: resolved.userId },
      select: { id: true },
    });
    if (!targetParent) {
      return NextResponse.json({ error: "Target page not found." }, { status: 404 });
    }
    if (await isSameOrAncestor(targetParentId, existing.id)) {
      return NextResponse.json({ error: "Can't move a page underneath one of its own sub-pages." }, { status: 400 });
    }
    nextParentId = targetParentId;
    data.parent = { connect: { id: targetParentId } };
  }

  if (body.order !== undefined && Number.isFinite(body.order)) {
    data.order = body.order;
  }

  try {
    const updated = await prisma.template.update({
      where: { id: existing.id },
      data,
      select: { id: true, name: true, slug: true, parentId: true, order: true },
    });
    return NextResponse.json({ page: updated });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "A page with this URL already exists here." }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  const existing = await prisma.template.findFirst({
    where: { id, userId: resolved.userId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  // Descendants and any linked PublishedDomain cascade at the DB level
  // (Template.parent / PublishedDomain.template are both onDelete: Cascade).
  await prisma.template.delete({ where: { id: existing.id } });

  return NextResponse.json({ success: true });
}
