import { NextRequest, NextResponse } from "next/server";
import { deleteObjects } from "@/lib/storage";

import { Template, TemplateAsset, PublishedDomain } from "@/lib/db/contentEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import { removeVercelDomain } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { isValidSlugSegment, isReservedTopLevelSlug, isSameOrAncestor, isValidUuid, slugify, getDescendantIds } from "@/server/slugDynamo";
import { isTemplateNameTaken } from "@/server/templateNameDynamo";
import { buildLivePreviewHtml } from "@/lib/buildLivePreviewHtml";

type PatchTemplateBody = {
  name?: string;
  slug?: string;
  parentId?: string | null;
  order?: number;
};

/**
 * GET /api/templates/:id
 *
 * Just enough to render a lightweight preview of one page — the Detail
 * page's page-switcher fetches this for whichever sub-page isn't the one
 * it already has compiledHtml for server-side.
 */
export async function GET(
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
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const { data: assets } = await TemplateAsset.query.primary({ templateId: id }).go();
  const previewHtml = await buildLivePreviewHtml(template.compiledHtml, assets.map((a) => ({ path: a.path, blobUrl: a.blobUrl })));
  return NextResponse.json({ page: { id: template.id, name: template.name, kind: template.kind, compiledHtml: template.compiledHtml, previewHtml } });
}

export async function PATCH(
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
  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchTemplateBody;
  const data: { name?: string; slug?: string; parentId?: string; order?: number } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    }
    if (await isTemplateNameTaken({ organizationId: resolved.organizationId, parentId: existing.parentId ?? null, kind: existing.kind, name, excludeId: existing.id })) {
      return NextResponse.json(
        { error: existing.parentId ? `This page already has a sub-page named "${name}".` : `You already have a ${existing.kind === "LANDING_PAGE" ? "site" : "email template"} named "${name}".` },
        { status: 409 },
      );
    }
    data.name = name;
  }

  if (body.slug !== undefined) {
    if (!existing.parentId) {
      return NextResponse.json({ error: "The home page doesn't have its own URL segment." }, { status: 400 });
    }
    const nextSlug = slugify(body.slug);
    if (!nextSlug || !isValidSlugSegment(nextSlug)) {
      return NextResponse.json({ error: "That page URL isn't valid. Use lowercase letters, numbers, and hyphens." }, { status: 400 });
    }
    data.slug = nextSlug;
  }

  let nextParentId = existing.parentId ?? null;
  if (body.parentId !== undefined) {
    if (!existing.parentId) {
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
    const { data: targetParent } = await Template.get({ id: targetParentId }).go();
    if (!targetParent || targetParent.organizationId !== resolved.organizationId) {
      return NextResponse.json({ error: "Target page not found." }, { status: 404 });
    }
    if (await isSameOrAncestor(targetParentId, existing.id)) {
      return NextResponse.json({ error: "Can't move a page underneath one of its own sub-pages." }, { status: 400 });
    }
    nextParentId = targetParentId;
    data.parentId = targetParentId;
  }

  if (body.order !== undefined && Number.isFinite(body.order)) {
    data.order = body.order;
  }

  const effectiveSlug = data.slug ?? existing.slug;
  if (effectiveSlug && nextParentId && (await isReservedTopLevelSlug(nextParentId, effectiveSlug))) {
    return NextResponse.json({ error: "That URL is reserved for the site's blog." }, { status: 400 });
  }

  // Sibling-slug uniqueness (prisma: @@unique([parentId, slug]), enforced there via a
  // P2002 catch) — checked explicitly here since a plain .patch() has no equivalent
  // built-in constraint to catch a violation of.
  if (data.slug !== undefined && nextParentId) {
    const { data: siblings } = await Template.query.byParent({ parentId: nextParentId }).go();
    if (siblings.some((s) => s.id !== existing.id && s.slug === data.slug)) {
      return NextResponse.json({ error: "A page with this URL already exists here." }, { status: 409 });
    }
  }

  await Template.patch({ id: existing.id }).set(data).go();
  const { data: updated } = await Template.get({ id: existing.id }).go();
  if (!updated) throw new Error(`Template ${existing.id} vanished immediately after being updated`);

  return NextResponse.json({ page: { id: updated.id, name: updated.name, slug: updated.slug ?? null, parentId: updated.parentId ?? null, order: updated.order ?? 0 } });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["delete"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const descendantIds = await getDescendantIds(resolved.organizationId, existing.id);
  const allIds = [existing.id, ...descendantIds];

  // TemplateAsset rows cascaded at the DB level under Prisma (Template.assets onDelete:
  // Cascade), but Vercel Blob has no idea a delete just happened there either way — clean
  // up the actual blob storage for this page and everything nested under it before
  // deleting the rows, otherwise every raw-uploaded file becomes a permanently orphaned,
  // still-billed blob.
  const assetBatches = await Promise.all(allIds.map((tid) => TemplateAsset.query.primary({ templateId: tid }).go()));
  const assets = assetBatches.flatMap((b) => b.data);
  if (assets.length > 0) {
    await deleteObjects(assets.map((a) => a.blobUrl)).catch((err) =>
      console.error("Failed to delete blobs during page delete (non-fatal):", err),
    );
  }
  await Promise.all(assets.map((a) => TemplateAsset.remove({ templateId: a.templateId, path: a.path }).go()));

  // Same problem for CUSTOM PublishedDomain rows: Vercel's own domain registry has no
  // idea a delete happened — a CUSTOM domain (added via addVercelDomain at link time)
  // stays attached to this Vercel project forever unless explicitly removed, blocking
  // that domain from ever being re-added ("already in use by one of your projects") even
  // though it no longer appears anywhere in the dashboard.
  const domainBatches = await Promise.all(allIds.map((tid) => PublishedDomain.query.primary({ templateId: tid }).go()));
  const domains = domainBatches.flatMap((b) => b.data);
  for (const d of domains) {
    if (d.type === "CUSTOM") {
      await removeVercelDomain(d.domain).catch((err) =>
        console.error(`Failed to remove Vercel domain ${d.domain} during page delete (non-fatal):`, err),
      );
    }
  }
  await Promise.all(domains.map((d) => PublishedDomain.remove({ templateId: d.templateId, id: d.id }).go()));

  // KNOWN GAP, not silently dropped: Prisma's schema cascades ~30 more relations off
  // Template (Comment, every Commerce* entity, blog layout fragments, TemplateRevision,
  // TemplatePurchase, etc.) — see DYNAMODB_CUTOVER_CHECKLIST.md. Only the two cleanups
  // above (TemplateAsset, PublishedDomain) are wired so far, matching what this route
  // already did manually pre-migration for the two systems Postgres's own cascade
  // couldn't reach (Vercel Blob, Vercel's domain registry). The rest need wiring as
  // Commerce/Content's remaining entities get cut over — deleting a template today does
  // NOT yet clean up its comments, commerce products/orders, or blog layout fragments.

  await Promise.all(descendantIds.map((did) => Template.remove({ id: did }).go()));
  await Template.remove({ id: existing.id }).go();

  return NextResponse.json({ success: true });
}
