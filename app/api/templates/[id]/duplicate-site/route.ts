import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { EntityItem } from "electrodb";
import { uploadObject } from "@/lib/storage";

import { Template, TemplateAsset } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { ensureUniqueSlug, isValidUuid } from "@/server/slugDynamo";
import { ensureUniqueTemplateName } from "@/server/templateNameDynamo";
import { getTierFeatures } from "@/lib/subscription";

type SourceTemplate = EntityItem<typeof Template>;

async function copyRawUploadAssets(sourceTemplateId: string, newTemplateId: string): Promise<void> {
  const { data: sourceAssets } = await TemplateAsset.query.primary({ templateId: sourceTemplateId }).go();
  if (sourceAssets.length === 0) return;
  const copied = await Promise.all(
    sourceAssets.map(async (asset) => {
      const sourceRes = await fetch(asset.blobUrl);
      const buffer = Buffer.from(await sourceRes.arrayBuffer());
      const blob = await uploadObject(`raw-sites/${newTemplateId}/${asset.path}`, buffer, {
        access: "public",
        contentType: asset.contentType,
      });
      return { templateId: newTemplateId, path: asset.path, blobUrl: blob.url, contentType: asset.contentType, size: buffer.byteLength };
    }),
  );
  await Promise.all(copied.map((a) => TemplateAsset.create({ id: randomUUID(), ...a }).go()));
}

/**
 * POST /api/templates/:id/duplicate-site
 *
 * Duplicates a whole site — the root Template plus every descendant page beneath it
 * (multi-level, via the same BFS getDescendantIds walk the DELETE route uses), each with
 * its own independent copy of RAW_UPLOAD assets (never a shared blob reference, same
 * reasoning as the single-page /duplicate route). The new site is a fully independent
 * root Template: no domain is attached (a duplicate always starts unclaimed, exactly like
 * a brand-new site — cloning a PublishedDomain row would either collide on a globally-unique
 * subdomain or falsely claim a live CloudFront tenant for a custom domain) and none of its
 * transactional data is copied — no orders, bookings, wallet balance, or reviews, only the
 * page structure and design/content that define what the site actually looks like.
 *
 * Deliberately out of scope for this pass: Blog (posts/authors/categories/tags) and
 * Commerce (products/settings/delivery methods) content, and the SiteLayout header/footer
 * fragment — those are cross-cutting features layered on top of a site's pages rather than
 * the pages themselves, each with its own uniqueness/identity concerns (slugs, SEO, live
 * payment config) that a silent full clone could get wrong. A duplicated site keeps its own
 * Site Layout/Blog/Commerce off until the owner deliberately sets each back up.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["create"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }

  // Scoped by the SOURCE site being duplicated — see the single-page /duplicate route's
  // identical comment.
  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }

  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  if (existing.parentId) {
    return NextResponse.json({ error: "Only a site's home page can be duplicated this way — use the Pages panel to duplicate a single sub-page." }, { status: 400 });
  }
  if (existing.isBlogLayout || existing.isSiteLayoutFragment || existing.isCommerceLayout) {
    return NextResponse.json({ error: "This template isn't a duplicable site." }, { status: 400 });
  }

  // BFS the full descendant tree (mirrors server/slugDynamo.ts's getDescendantIds, but
  // keeping each row instead of just its id — every level gets its own new id up front so
  // every child's parentId can be remapped to its new parent before any row is written).
  const idMap = new Map<string, string>([[existing.id, randomUUID()]]);
  const descendants: SourceTemplate[] = [];
  let frontier = [existing.id];
  while (frontier.length > 0) {
    const childBatches = await Promise.all(frontier.map((parentId) => Template.query.byParent({ parentId }).go()));
    const children = childBatches.flatMap((b) => b.data).filter((c) => c.organizationId === resolved.organizationId);
    for (const child of children) idMap.set(child.id, randomUUID());
    descendants.push(...children);
    frontier = children.map((c) => c.id);
  }

  const features = getTierFeatures(resolved.subscriptionPlan);
  if (descendants.length > 0 && !features.multiPageSitesEnabled) {
    return NextResponse.json(
      { error: "This site has multiple pages — duplicating it requires an Ultra subscription plan.", plan: resolved.subscriptionPlan },
      { status: 403 },
    );
  }
  {
    const limit = existing.kind === "LANDING_PAGE" ? features.maxLandingPages : features.maxEmailTemplates;
    const { data: orgRoots } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const count = orgRoots.filter((t) => !t.parentId && t.kind === existing.kind && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout).length;
    if (count >= limit) {
      const label = existing.kind === "LANDING_PAGE" ? "landing pages" : "email templates";
      return NextResponse.json(
        { error: `Your plan allows a maximum of ${limit} ${label}. Upgrade to create more.`, plan: resolved.subscriptionPlan },
        { status: 403 },
      );
    }
  }

  const newRootId = idMap.get(existing.id)!;
  const rootName = await ensureUniqueTemplateName({ organizationId: resolved.organizationId, parentId: null, kind: existing.kind, base: `${existing.name} copy` });

  await Template.create({
    id: newRootId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    name: rootName,
    kind: existing.kind,
    sourceType: existing.sourceType,
    designJson: existing.designJson,
    compiledHtml: existing.compiledHtml,
    // Deliberately no parentId/slug/order — a root template never has them (see
    // app/api/templates/route.ts's own POST handler), and no PublishedDomain is created —
    // the duplicate starts unclaimed like any brand-new site.
  }).go();
  if (existing.sourceType === "RAW_UPLOAD") {
    await copyRawUploadAssets(existing.id, newRootId);
  }

  // Descendants were discovered breadth-first, so every row's parentId is guaranteed to
  // already be in idMap (either the new root or an earlier sibling level) by the time we
  // get here — safe to create in this same order.
  for (const child of descendants) {
    const newChildId = idMap.get(child.id)!;
    const newParentId = idMap.get(child.parentId!)!;
    const slug = await ensureUniqueSlug(newParentId, child.slug ?? child.name);
    await Template.create({
      id: newChildId,
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      name: child.name,
      kind: child.kind,
      sourceType: child.sourceType,
      parentId: newParentId,
      slug,
      order: child.order ?? 0,
      designJson: child.designJson,
      compiledHtml: child.compiledHtml,
    }).go();
    if (child.sourceType === "RAW_UPLOAD") {
      await copyRawUploadAssets(child.id, newChildId);
    }
  }

  const { data: duplicate } = await Template.get({ id: newRootId }).go();
  if (!duplicate) throw new Error(`Template ${newRootId} vanished immediately after being created`);

  return NextResponse.json(
    { template: { id: duplicate.id, name: duplicate.name, kind: duplicate.kind, pageCount: descendants.length } },
    { status: 201 },
  );
}
