import { NextRequest, NextResponse } from "next/server";
import { put, BlobError } from "@vercel/blob";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { contentTypeFor } from "@/server/rawUpload";
import { extractTextNodes, applyTextEdits, annotateTextNodesForPreview } from "@/lib/htmlTextExtraction";
import {
  extractImageNodes,
  annotateImageNodesForPreview,
  applyImageEdits,
  type ImgEdit,
  type BackgroundEdit,
} from "@/lib/htmlImageExtraction";
import {
  extractColorNodes,
  annotateColorNodesForPreview,
  applyColorEdits,
  type ColorEdit,
  type ExternalStylesheet,
} from "@/lib/htmlColorExtraction";
import { rewriteAssetReferencesForPreview } from "@/lib/htmlAssetRewrite";
import { forceRevealAnimationsForPreview } from "@/lib/htmlRevealPreview";
import { scanPublishedDomain } from "@/lib/safeBrowsing";

/**
 * A multi-file RAW_UPLOAD template's CSS is often entirely in linked stylesheets
 * (TemplateAsset, stored in Vercel Blob) rather than inline <style> blocks — color
 * extraction needs their actual text to find anything defined there (including, commonly,
 * every CSS variable a hand-built template's brand colors are defined as). Fetched fresh
 * every request, same as app/api/v1/templates/[id]/files/route.ts's GET already does for
 * the file-listing endpoint — there's no content column to read from instead.
 */
async function fetchCssStylesheetContents(
  assets: { path: string; blobUrl: string }[],
): Promise<ExternalStylesheet[]> {
  const cssAssets = assets.filter((a) => a.path.toLowerCase().endsWith(".css"));
  const fetched = await Promise.all(
    cssAssets.map(async (a) => {
      const res = await fetch(a.blobUrl).catch(() => null);
      const content = res && res.ok ? await res.text() : "";
      return { path: a.path, content };
    }),
  );
  return fetched.filter((s) => s.content.length > 0);
}

/**
 * GET /api/v1/templates/:id/text-content
 *
 * Extracts every visible text node from a RAW_UPLOAD template's index.html — paragraphs,
 * headings, menu items, button labels, etc. — for the "Text Content" editing mode, so a
 * non-technical user can rewrite copy without touching markup. See lib/htmlTextExtraction.ts.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const template = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: {
      sourceType: true,
      compiledHtml: true,
      assets: { select: { path: true, blobUrl: true } },
    },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "This template was not created via raw upload." }, { status: 400 });
  }

  const externalStylesheets = await fetchCssStylesheetContents(template.assets);

  const nodes = extractTextNodes(template.compiledHtml);
  const imageNodes = extractImageNodes(template.compiledHtml);
  const colorNodes = extractColorNodes(template.compiledHtml, externalStylesheets);
  // Compose color + text + image annotation into one preview doc. Color goes first and
  // against the pristine html specifically: annotateColorNodesForPreview re-derives ids by
  // calling extractColorNodes on whatever html it's given, and that MUST be the same html
  // (+ the same externalStylesheets) colorNodes above was computed from for the ids to line
  // up — running it after the other two passes would still happen to work today (neither
  // touches style attributes/blocks in a way that shifts color ordering), but doing color
  // first removes the need to rely on that. Text/image annotation are unaffected by
  // data-pcolor attributes already being present, since their own walks key off text nodes /
  // img tags, not this attribute.
  //
  // rewriteAssetReferencesForPreview and forceRevealAnimationsForPreview both go LAST and
  // only affect this disposable preview copy: the former because a multi-file upload's
  // <link href="css/styles.css">/<img src="...">/etc. are relative paths with nothing to
  // resolve against inside a sandboxed srcDoc iframe (no real URL of its own), and the
  // latter because this preview deliberately never runs page JS — see
  // htmlRevealPreview.ts's doc comment — so any scroll-triggered "reveal" section would
  // otherwise stay invisible forever.
  const previewHtml = forceRevealAnimationsForPreview(
    rewriteAssetReferencesForPreview(
      annotateImageNodesForPreview(
        annotateTextNodesForPreview(annotateColorNodesForPreview(template.compiledHtml, externalStylesheets)),
      ),
      template.assets,
      externalStylesheets,
    ),
    externalStylesheets,
  );
  return NextResponse.json({ nodes, imageNodes, colorNodes, previewHtml });
}

/**
 * PATCH /api/v1/templates/:id/text-content
 *
 * Applies a batch of text-node edits (from the same GET's node ids) back into index.html.
 * Unsanitized, same as every other RAW_UPLOAD write path — see files/[...path]/route.ts's
 * identical doc comment for why.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const template = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: {
      id: true,
      sourceType: true,
      compiledHtml: true,
      assets: { select: { id: true, path: true, blobUrl: true } },
    },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "This template was not created via raw upload." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    edits?: { id?: number; text?: string; href?: string }[];
    imgEdits?: { id?: number; src?: string; width?: number | null; height?: number | null }[];
    backgroundEdits?: { id?: number; src?: string; backgroundSize?: string | null }[];
    colorEdits?: { id?: number; value?: string }[];
  } | null;
  const rawEdits = Array.isArray(body?.edits) ? body.edits : [];
  const rawImgEdits = Array.isArray(body?.imgEdits) ? body.imgEdits : [];
  const rawBackgroundEdits = Array.isArray(body?.backgroundEdits) ? body.backgroundEdits : [];
  const rawColorEdits = Array.isArray(body?.colorEdits) ? body.colorEdits : [];
  if (rawEdits.length === 0 && rawImgEdits.length === 0 && rawBackgroundEdits.length === 0 && rawColorEdits.length === 0) {
    return NextResponse.json({ error: "No edits provided." }, { status: 400 });
  }
  const edits = rawEdits
    .filter((e): e is { id: number; text: string; href?: string } => typeof e.id === "number" && typeof e.text === "string")
    .map((e) => ({ id: e.id, text: e.text, ...(typeof e.href === "string" ? { href: e.href } : {}) }));
  const imgEdits: ImgEdit[] = rawImgEdits
    .filter((e): e is { id: number; src?: string; width?: number | null; height?: number | null } => typeof e.id === "number")
    .map((e) => ({ id: e.id, src: e.src, width: e.width, height: e.height }));
  const backgroundEdits: BackgroundEdit[] = rawBackgroundEdits
    .filter((e): e is { id: number; src?: string; backgroundSize?: string | null } => typeof e.id === "number")
    .map((e) => ({ id: e.id, src: e.src, backgroundSize: e.backgroundSize }));
  const colorEdits: ColorEdit[] = rawColorEdits
    .filter((e): e is { id: number; value: string } => typeof e.id === "number" && typeof e.value === "string")
    .map((e) => ({ id: e.id, value: e.value }));

  let updatedHtml = applyTextEdits(template.compiledHtml, edits);
  updatedHtml = applyImageEdits(updatedHtml, imgEdits, backgroundEdits);

  if (colorEdits.length > 0) {
    const externalStylesheets = await fetchCssStylesheetContents(template.assets);
    const colorResult = applyColorEdits(updatedHtml, colorEdits, externalStylesheets);
    updatedHtml = colorResult.html;

    // A color edit that landed on a var(--x) defined inside (or a declaration living in) a
    // linked stylesheet rewrites THAT file's own content — persist each one back to blob
    // storage in place, same pattern files/[...path]/route.ts's PUT already uses for saving
    // any other file edit.
    const stylesheetPaths = Object.keys(colorResult.updatedStylesheets);
    if (stylesheetPaths.length > 0) {
      const localDevToken = process.env.BLOB_READ_WRITE_TOKEN; // see upload-raw/route.ts — OIDC covers real deployments
      await Promise.all(
        stylesheetPaths.map(async (path) => {
          const asset = template.assets.find((a) => a.path === path);
          if (!asset) return;
          const newContent = colorResult.updatedStylesheets[path];
          const contentType = contentTypeFor(path);
          try {
            const blob = await put(`raw-sites/${template.id}/${path}`, Buffer.from(newContent, "utf8"), {
              access: "public",
              contentType,
              allowOverwrite: true,
              ...(localDevToken ? { token: localDevToken } : {}),
            });
            await prisma.templateAsset.update({
              where: { id: asset.id },
              data: { blobUrl: blob.url, contentType, size: Buffer.byteLength(newContent, "utf8") },
            });
          } catch (err) {
            if (err instanceof BlobError) {
              console.error(`Failed to save color edit to ${path}:`, err.message);
              return;
            }
            throw err;
          }
        }),
      );
    }
  }

  await prisma.template.update({
    where: { id: template.id },
    data: { compiledHtml: updatedHtml },
  });

  // Content changed — re-scan every domain it's currently live on, same as files/[...path].
  const linkedDomains = await prisma.publishedDomain.findMany({
    where: { templateId: template.id },
    select: { id: true },
  });
  for (const d of linkedDomains) {
    void scanPublishedDomain(d.id).catch((err) => console.error("Safe Browsing scan failed:", err));
  }

  return NextResponse.json({ success: true });
}
