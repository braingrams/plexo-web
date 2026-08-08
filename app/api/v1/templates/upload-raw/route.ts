import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { put, BlobError } from "@vercel/blob";
import { TemplateKind } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { getTierFeatures } from "@/lib/subscription";
import { ensureUniqueSlug, isValidUuid } from "@/server/slug";
import {
  extractZipUpload,
  validateSingleHtmlUpload,
  RawUploadValidationError,
  extensionOf,
  humanizePageFilename,
  type ExtractedSite,
  type ExtractedAsset,
} from "@/server/rawUpload";

// Per-account cap on RAW_UPLOAD template creation — a plain DB count query rather than a
// dedicated rate-limit store, since there's no Redis/Upstash in this stack yet. Fine at
// current scale; swap for a token-bucket in Upstash if raw uploads get high-volume.
const RAW_UPLOAD_DAILY_LIMIT = 15;

/**
 * POST /api/v1/templates/upload-raw
 *
 * Publishes a self-contained HTML site (single .html/.htm, or a .zip with index.html at
 * its root plus css/js/images/fonts) as a Template with NO HTML sanitization — the
 * content is served byte-for-byte as uploaded. This is safe only because served content
 * lives on the isolated plexopages.io origin (see server/pagesDomain.ts), never on the
 * dashboard's own domain, and carries no ambient cookies/session.
 *
 * multipart/form-data fields:
 *   name       (optional) display name for the template
 *   file       required — a .html/.htm or .zip File
 *   acceptAup  "true" — required on an account's first raw upload (see /legal/acceptable-use)
 *   parentId   (optional) an existing LANDING_PAGE template's id — when present, this
 *              upload becomes a sub-page under it (e.g. an uploaded "about" page next to
 *              a DnD-built home page) instead of a new top-level site. Mixed-mode sites
 *              are supported page-by-page: each page's own sourceType decides how /pub
 *              serves it, independent of its siblings — see app/pub/[domain]/[[...slug]].
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid session or API key required." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["create"] });
  if (permissionError) return permissionError;

  const features = getTierFeatures(resolved.subscriptionPlan);

  const user = await prisma.user.findUnique({
    where: { id: resolved.userId },
    select: { aupAcceptedAt: true },
  });

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const acceptAup = form.get("acceptAup") === "true";
  if (!user?.aupAcceptedAt) {
    if (!acceptAup) {
      return NextResponse.json({
        error: "You must accept the Acceptable Use Policy before publishing unsanitized HTML.",
        requiresAupAcceptance: true,
        aupUrl: "/legal/acceptable-use",
      }, { status: 403 });
    }
    await prisma.user.update({
      where: { id: resolved.userId },
      data: { aupAcceptedAt: new Date() },
    });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing required 'file' field." }, { status: 400 });
  }

  const name = (form.get("name") as string | null)?.trim() || file.name.replace(/\.(html?|zip)$/i, "") || "Uploaded Site";

  const parentIdInput = (form.get("parentId") as string | null)?.trim() || null;
  let slug: string | null = null;
  let order = 0;
  if (parentIdInput) {
    // Same Ultra-gating as adding a DnD sub-page (app/api/templates/route.ts) — a raw
    // upload used as a sub-page is still a sub-page for plan-limit purposes.
    if (!features.multiPageSitesEnabled) {
      return NextResponse.json(
        { error: "Multi-page sites require an Ultra subscription plan." },
        { status: 403 }
      );
    }
    if (!isValidUuid(parentIdInput)) {
      return NextResponse.json({ error: "Parent page not found." }, { status: 404 });
    }
    const parent = await prisma.template.findFirst({
      where: { id: parentIdInput, organizationId: resolved.organizationId },
      select: { id: true, kind: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "Parent page not found." }, { status: 404 });
    }
    if (parent.kind !== TemplateKind.LANDING_PAGE) {
      return NextResponse.json({ error: "Only landing pages can have sub-pages." }, { status: 400 });
    }
    slug = await ensureUniqueSlug(parentIdInput, name);
    const lastSibling = await prisma.template.findFirst({
      where: { parentId: parentIdInput },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    order = (lastSibling?.order ?? -1) + 1;
  } else {
    // The plan's landing-page limit counts root/home pages only, matching /api/templates.
    // Raw uploads always create a LANDING_PAGE, so this checks maxLandingPages.
    const templateCount = await prisma.template.count({ where: { organizationId: resolved.organizationId, parentId: null, kind: TemplateKind.LANDING_PAGE, isBlogLayout: false } });
    if (templateCount >= features.maxLandingPages) {
      return NextResponse.json(
        { error: `Template limit reached (${features.maxLandingPages} landing pages). Upgrade plan to create more.` },
        { status: 403 }
      );
    }
  }

  // Per-account rate limit on raw uploads specifically — this is the abuse-prone path
  // (unsanitized, arbitrary JS), so it gets its own tighter ceiling independent of the
  // general template limit above.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentUploadCount = await prisma.template.count({
    where: { userId: resolved.userId, sourceType: "RAW_UPLOAD", createdAt: { gte: since } },
  });
  if (recentUploadCount >= RAW_UPLOAD_DAILY_LIMIT) {
    return NextResponse.json({
      error: `You've reached the raw-upload limit of ${RAW_UPLOAD_DAILY_LIMIT} per 24 hours. Try again later.`,
    }, { status: 429 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let site: ExtractedSite;
  try {
    site = file.name.toLowerCase().endsWith(".zip")
      ? await extractZipUpload(buffer)
      : validateSingleHtmlUpload(file.name, buffer);
  } catch (err) {
    if (err instanceof RawUploadValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // On an actual Vercel deployment, the store's OIDC token (auto-injected, short-lived,
  // no env var needed) authenticates this automatically — the SDK picks it up on its own.
  // BLOB_READ_WRITE_TOKEN is only read here as a fallback for environments without OIDC
  // (i.e. local `next dev`); don't set it in Vercel's own project env vars once you've
  // confirmed OIDC works, per Vercel's own guidance to revoke unused static tokens.
  const localDevToken = process.env.BLOB_READ_WRITE_TOKEN;

  type UploadedAssetRow = { templateId: string; path: string; blobUrl: string; contentType: string; size: number };

  async function uploadAssetsFor(ownerId: string, assets: ExtractedAsset[]): Promise<UploadedAssetRow[]> {
    if (assets.length === 0) return [];
    return Promise.all(
      assets.map(async (asset) => {
        const blob = await put(`raw-sites/${ownerId}/${asset.path}`, asset.buffer, {
          access: "public",
          contentType: asset.contentType,
          ...(localDevToken ? { token: localDevToken } : {}),
        });
        return {
          templateId: ownerId,
          path: asset.path,
          blobUrl: blob.url,
          contentType: asset.contentType,
          size: asset.buffer.byteLength,
        };
      })
    );
  }

  // A zip with more than one root-level .html file (about.html, services.html, ... next to
  // index.html) is a multi-page site the user already built — register it as one instead of
  // flattening every extra page into a same-level "editable text asset" on a single Template
  // row, which is what happens below for everyone else. Root-level only (no "/" in the path):
  // a nested html file (e.g. "blog/post-1.html") is far more likely to be a partial/include
  // than a real top-level page, so it's left alone as a flat asset either way. Gated the same
  // as every other multi-page feature (PagesPanel's own nudge) and skipped entirely for a
  // sub-page upload (parentIdInput set) — splitting a page that's ITSELF being nested under
  // another page adds a second level of complexity this isn't trying to solve.
  const autoSplitPages = !parentIdInput && features.multiPageSitesEnabled;
  const extraPageAssets = autoSplitPages
    ? site.assets.filter((a) => !a.path.includes("/") && ["html", "htm"].includes(extensionOf(a.path)))
    : [];
  const sharedAssets = extraPageAssets.length > 0
    ? site.assets.filter((a) => !extraPageAssets.includes(a))
    : site.assets;

  // Generate the id up front so blob paths can be namespaced by it, and upload assets
  // BEFORE writing anything to Postgres — if storage isn't reachable, nothing is left
  // half-created in the database.
  const templateId = randomUUID();
  let uploadedAssets: UploadedAssetRow[];
  try {
    uploadedAssets = await uploadAssetsFor(templateId, sharedAssets);
  } catch (err) {
    if (err instanceof BlobError) {
      console.error("Blob storage upload failed:", err.message);
      return NextResponse.json({
        error: "Storage isn't available for multi-file uploads right now. Upload a single self-contained .html file, or contact support.",
      }, { status: 500 });
    }
    throw err;
  }

  const template = await prisma.template.create({
    data: {
      id: templateId,
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      name,
      kind: "LANDING_PAGE",
      sourceType: "RAW_UPLOAD",
      designJson: {}, // no builder representation for raw uploads
      compiledHtml: site.indexHtml,
      parentId: parentIdInput,
      slug,
      order,
    },
  });

  if (uploadedAssets.length > 0) {
    await prisma.templateAsset.createMany({ data: uploadedAssets });
  }

  // Each extra root-level page gets its OWN copy of the shared css/js/image/font assets —
  // TemplateAsset rows are scoped per-template (blob paths are namespaced by templateId, see
  // uploadAssetsFor above), so a sub-page can't just point at the root page's copies the way
  // a real static site's shared /css folder would. One page's upload failure here doesn't
  // roll back the ones already created, or the root page itself — it's still a strict
  // improvement over today's behavior (a flat, uneditable-as-a-page asset), so it's logged
  // and skipped rather than failing the whole request.
  let subPagesCreated = 0;
  for (const [index, pageAsset] of extraPageAssets.entries()) {
    const pageName = humanizePageFilename(pageAsset.path);
    try {
      const pageSlug = await ensureUniqueSlug(templateId, pageName);
      const childId = randomUUID();
      const childAssets = await uploadAssetsFor(childId, sharedAssets);
      await prisma.template.create({
        data: {
          id: childId,
          userId: resolved.userId,
          organizationId: resolved.organizationId,
          name: pageName,
          kind: "LANDING_PAGE",
          sourceType: "RAW_UPLOAD",
          designJson: {},
          compiledHtml: pageAsset.buffer.toString("utf8"),
          parentId: templateId,
          slug: pageSlug,
          order: index,
        },
      });
      if (childAssets.length > 0) {
        await prisma.templateAsset.createMany({ data: childAssets });
      }
      subPagesCreated++;
    } catch (err) {
      console.error(`Failed to register "${pageAsset.path}" as a sub-page:`, err);
    }
  }

  return NextResponse.json({
    success: true,
    templateId: template.id,
    name: template.name,
    assetCount: sharedAssets.length,
    subPagesCreated,
    message: "Site uploaded. Link it to a subdomain or custom domain from Domain Management to go live.",
  });
}
