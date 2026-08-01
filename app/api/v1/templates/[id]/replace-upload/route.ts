import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import {
  extractZipUpload,
  validateSingleHtmlUpload,
  RawUploadValidationError,
  type ExtractedSite,
} from "@/server/rawUpload";
import { scanPublishedDomain } from "@/lib/safeBrowsing";

/**
 * POST /api/v1/templates/:id/replace-upload
 *
 * Wholesale-replaces every file on an existing RAW_UPLOAD template with a freshly
 * uploaded .html/.htm or .zip — same validation as the initial upload (server/rawUpload.ts),
 * still unsanitized by design. Unlike creating a new template via /upload-raw, this keeps
 * the same template id, so any domain already linked to it (PublishedDomain.templateId)
 * stays linked with no re-linking step.
 *
 * multipart/form-data fields: file (required), name (optional, renames the template).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const template = await prisma.template.findFirst({ where: { id, organizationId: resolved.organizationId } });
  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "Only raw-upload templates can be replaced this way." }, { status: 400 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing required 'file' field." }, { status: 400 });
  }
  const name = (form.get("name") as string | null)?.trim();

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

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN; // see upload-raw/route.ts — OIDC covers real deployments
  const oldAssets = await prisma.templateAsset.findMany({ where: { templateId: template.id } });

  // Upload the new assets FIRST, before touching anything old — if this fails partway,
  // the live template/domain is untouched rather than left half-replaced.
  const uploaded: { templateId: string; path: string; blobUrl: string; contentType: string; size: number }[] = [];
  if (site.assets.length > 0) {
    try {
      for (const asset of site.assets) {
        const blob = await put(`raw-sites/${template.id}/${asset.path}`, asset.buffer, {
          access: "public",
          contentType: asset.contentType,
          allowOverwrite: true,
          ...(blobToken ? { token: blobToken } : {}),
        });
        uploaded.push({
          templateId: template.id,
          path: asset.path,
          blobUrl: blob.url,
          contentType: asset.contentType,
          size: asset.buffer.byteLength,
        });
      }
    } catch (err) {
      console.error("Blob upload failed during replace:", err);
      return NextResponse.json({
        error: "Storage isn't available right now — nothing was changed. Try again shortly.",
      }, { status: 500 });
    }
  }

  // Now safe to tear down the old files: DB row deletion + blob deletion for whatever
  // isn't present in the new upload (a path reused by both old and new was just
  // overwritten in place above via allowOverwrite).
  await prisma.templateAsset.deleteMany({ where: { templateId: template.id } });
  const staleBlobUrls = oldAssets
    .filter((a) => !uploaded.some((u) => u.path === a.path))
    .map((a) => a.blobUrl);
  if (staleBlobUrls.length > 0) {
    await del(staleBlobUrls, blobToken ? { token: blobToken } : undefined).catch((err) =>
      console.error("Failed to delete stale blobs during replace (non-fatal):", err)
    );
  }

  await prisma.template.update({
    where: { id: template.id },
    data: {
      compiledHtml: site.indexHtml,
      ...(name ? { name } : {}),
    },
  });
  if (uploaded.length > 0) {
    await prisma.templateAsset.createMany({ data: uploaded });
  }

  // Content changed under every domain this template is live on — re-scan rather than
  // wait for the next periodic cron pass.
  const linkedDomains = await prisma.publishedDomain.findMany({
    where: { templateId: template.id },
    select: { id: true },
  });
  for (const d of linkedDomains) {
    void scanPublishedDomain(d.id).catch((err) => console.error("Safe Browsing scan failed:", err));
  }

  return NextResponse.json({ success: true, templateId: template.id, assetCount: uploaded.length });
}
