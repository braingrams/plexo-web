import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { uploadObject } from "@/lib/storage";

import { Template, TemplateAsset } from "@/lib/db/contentEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { ensureUniqueSlug, isValidUuid } from "@/server/slugDynamo";
import { ensureUniqueTemplateName } from "@/server/templateNameDynamo";
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

  const permissionError = requirePermission(resolved.role, { template: ["create"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  if (!existing.parentId) {
    return NextResponse.json({ error: "The home page can't be duplicated from here." }, { status: 400 });
  }

  const { data: siblings } = await Template.query.byParent({ parentId: existing.parentId }).go();
  const lastOrder = siblings.reduce((max, s) => Math.max(max, s.order ?? 0), -1);

  const name = await ensureUniqueTemplateName({ organizationId: resolved.organizationId, parentId: existing.parentId, kind: existing.kind, base: `${existing.name} copy` });
  const slug = await ensureUniqueSlug(existing.parentId, `${existing.slug ?? name}-copy`);

  // Raw-upload pages own real files in S3 — those need independent copies, not a shared
  // reference, so editing/deleting one page's files can never silently break its
  // duplicate (or vice versa).
  const newId = randomUUID();
  let copiedAssets: { templateId: string; path: string; blobUrl: string; contentType: string; size: number }[] = [];
  if (existing.sourceType === "RAW_UPLOAD") {
    const { data: sourceAssets } = await TemplateAsset.query.primary({ templateId: existing.id }).go();
    if (sourceAssets.length > 0) {
      copiedAssets = await Promise.all(
        sourceAssets.map(async (asset) => {
          const sourceRes = await fetch(asset.blobUrl);
          const buffer = Buffer.from(await sourceRes.arrayBuffer());
          const blob = await uploadObject(`raw-sites/${newId}/${asset.path}`, buffer, {
            access: "public",
            contentType: asset.contentType,
          });
          return {
            templateId: newId,
            path: asset.path,
            blobUrl: blob.url,
            contentType: asset.contentType,
            size: buffer.byteLength,
          };
        })
      );
    }
  }

  await Template.create({
    id: newId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    name,
    kind: existing.kind,
    sourceType: existing.sourceType,
    parentId: existing.parentId,
    slug,
    order: lastOrder + 1,
    designJson: existing.designJson,
    compiledHtml: existing.compiledHtml,
  }).go();
  const { data: duplicate } = await Template.get({ id: newId }).go();
  if (!duplicate) throw new Error(`Template ${newId} vanished immediately after being created`);

  if (copiedAssets.length > 0) {
    await Promise.all(copiedAssets.map((a) => TemplateAsset.create({ id: randomUUID(), ...a }).go()));
  }

  return NextResponse.json({
    page: { id: duplicate.id, name: duplicate.name, slug: duplicate.slug ?? null, parentId: duplicate.parentId ?? null, order: duplicate.order ?? 0 },
  }, { status: 201 });
}
