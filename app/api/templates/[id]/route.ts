import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { del } from "@vercel/blob";

import { prisma } from "@/server/prisma";
import { resolveUser, removeVercelDomain } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { isValidSlugSegment, isReservedTopLevelSlug, isSameOrAncestor, isValidUuid, slugify, getDescendantIds } from "@/server/slug";
import { isTemplateNameTaken } from "@/server/templateName";

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

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  const existing = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
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
    if (await isTemplateNameTaken({ organizationId: resolved.organizationId, parentId: existing.parentId, kind: existing.kind, name, excludeId: existing.id })) {
      return NextResponse.json(
        { error: existing.parentId ? `This page already has a sub-page named "${name}".` : `You already have a ${existing.kind === "LANDING_PAGE" ? "site" : "email template"} named "${name}".` },
        { status: 409 },
      );
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
      where: { id: targetParentId, organizationId: resolved.organizationId },
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

  const effectiveSlug = typeof data.slug === "string" ? data.slug : existing.slug;
  if (effectiveSlug && (await isReservedTopLevelSlug(nextParentId as string, effectiveSlug))) {
    return NextResponse.json({ error: "That URL is reserved for the site's blog." }, { status: 400 });
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

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["delete"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  const existing = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const descendantIds = await getDescendantIds(resolved.organizationId, existing.id);

  // TemplateAsset rows cascade at the DB level (Template.assets onDelete: Cascade), but
  // Vercel Blob has no idea Postgres just deleted anything — clean up the actual blob
  // storage for this page and everything nested under it before the cascade fires,
  // otherwise every raw-uploaded file becomes a permanently orphaned, still-billed blob.
  const assets = await prisma.templateAsset.findMany({
    where: { templateId: { in: [existing.id, ...descendantIds] } },
    select: { blobUrl: true },
  });
  if (assets.length > 0) {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    await del(assets.map((a) => a.blobUrl), blobToken ? { token: blobToken } : undefined).catch((err) =>
      console.error("Failed to delete blobs during page delete (non-fatal):", err)
    );
  }

  // Same problem for CUSTOM PublishedDomain rows: they cascade at the DB level, but
  // Vercel's own domain registry has no idea — a CUSTOM domain (added via addVercelDomain
  // at link time) stays attached to this Vercel project forever unless explicitly
  // removed, blocking that domain from ever being re-added ("already in use by one of
  // your projects") even though it no longer appears anywhere in the dashboard.
  const domainsToRemove = await prisma.publishedDomain.findMany({
    where: { templateId: { in: [existing.id, ...descendantIds] }, type: "CUSTOM" },
    select: { domain: true },
  });
  for (const d of domainsToRemove) {
    await removeVercelDomain(d.domain).catch((err) =>
      console.error(`Failed to remove Vercel domain ${d.domain} during page delete (non-fatal):`, err)
    );
  }

  // Descendants and any linked PublishedDomain cascade at the DB level
  // (Template.parent / PublishedDomain.template are both onDelete: Cascade).
  await prisma.template.delete({ where: { id: existing.id } });

  return NextResponse.json({ success: true });
}
