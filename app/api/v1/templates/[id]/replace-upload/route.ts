import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { uploadObject, deleteObjects } from "@/lib/storage";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import {
  extractZipUpload,
  validateSingleHtmlUpload,
  validateRawHtmlContent,
  RawUploadValidationError,
  type ExtractedSite,
} from "@/server/rawUpload";
import { scanPublishedDomain } from "@/lib/safeBrowsing";
import { Template, TemplateAsset, PublishedDomain } from "@/lib/db/contentEntities";

/**
 * POST /api/v1/templates/:id/replace-upload
 *
 * Wholesale-replaces every file on an existing RAW_UPLOAD template with freshly supplied
 * content — same validation as the initial upload (server/rawUpload.ts), still unsanitized
 * by design. Unlike creating a new template via /upload-raw, this keeps the same template
 * id, so any domain already linked to it (PublishedDomain.templateId) stays linked with no
 * re-linking step.
 *
 * Two request shapes:
 *   - multipart/form-data { file, name? } — file is a .html/.htm or .zip File.
 *   - application/json { htmlContent, name? } — a single self-contained HTML document for
 *     programmatic/MCP callers with no real file to upload; no zip/multi-file equivalent on
 *     this path (any existing multi-file assets are dropped, same as a fresh single-file
 *     upload replacing a multi-file one via the multipart path).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "Only raw-upload templates can be replaced this way." }, { status: 400 });
  }

  const isMultipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");

  let name: string | undefined;
  let site: ExtractedSite;
  try {
    if (isMultipart) {
      const form = await request.formData().catch(() => null);
      if (!form) {
        return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
      }
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing required 'file' field." }, { status: 400 });
      }
      name = (form.get("name") as string | null)?.trim() || undefined;
      const buffer = Buffer.from(await file.arrayBuffer());
      site = file.name.toLowerCase().endsWith(".zip")
        ? await extractZipUpload(buffer)
        : validateSingleHtmlUpload(file.name, buffer);
    } else {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.htmlContent !== "string") {
        return NextResponse.json(
          { error: "Expected multipart/form-data with a 'file' field, or a JSON body with 'htmlContent'." },
          { status: 400 }
        );
      }
      validateRawHtmlContent(body.htmlContent);
      name = typeof body.name === "string" ? body.name.trim() || undefined : undefined;
      site = { indexHtml: body.htmlContent, assets: [] };
    }
  } catch (err) {
    if (err instanceof RawUploadValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const { data: oldAssets } = await TemplateAsset.query.primary({ templateId: template.id }).go();

  // Upload the new assets FIRST, before touching anything old — if this fails partway,
  // the live template/domain is untouched rather than left half-replaced.
  const uploaded: { templateId: string; path: string; blobUrl: string; contentType: string; size: number }[] = [];
  if (site.assets.length > 0) {
    try {
      for (const asset of site.assets) {
        const blob = await uploadObject(`raw-sites/${template.id}/${asset.path}`, asset.buffer, {
          access: "public",
          contentType: asset.contentType,
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
  // overwritten in place above).
  await Promise.all(oldAssets.map((a) => TemplateAsset.remove({ templateId: a.templateId, path: a.path }).go()));
  const staleBlobUrls = oldAssets
    .filter((a) => !uploaded.some((u) => u.path === a.path))
    .map((a) => a.blobUrl);
  if (staleBlobUrls.length > 0) {
    await deleteObjects(staleBlobUrls).catch((err) =>
      console.error("Failed to delete stale blobs during replace (non-fatal):", err)
    );
  }

  await Template.patch({ id: template.id })
    .set({ compiledHtml: site.indexHtml, ...(name ? { name } : {}) })
    .go();
  if (uploaded.length > 0) {
    await Promise.all(uploaded.map((a) => TemplateAsset.create({ id: randomUUID(), ...a }).go()));
  }

  // Content changed under every domain this template is live on — re-scan rather than
  // wait for the next periodic cron pass.
  const { data: linkedDomains } = await PublishedDomain.query.primary({ templateId: template.id }).go();
  for (const d of linkedDomains) {
    void scanPublishedDomain(d.templateId, d.id).catch((err) => console.error("Safe Browsing scan failed:", err));
  }

  return NextResponse.json({ success: true, templateId: template.id, assetCount: uploaded.length });
}
