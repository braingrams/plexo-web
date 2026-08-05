import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { compileToHTML } from "@/lib/compiler";
import { TemplateJSONSchema, hydrateStructuralDefaults, formatValidationIssues, sanitizeHtml } from "@/server/sanitizer";
import { resolveUser } from "../../domains/route";
import { requirePermission } from "@/server/requirePermission";

/**
 * PUT /api/v1/templates/:id
 *
 * Companion to POST /api/v1/publish for AI tools (MCP server, ChatGPT Custom Actions,
 * Agents) — edits an existing template's content in place under the same id, instead of
 * creating a new one. Does not touch domain/publish state; a landing page's live URL and
 * domain are unaffected by this call.
 *
 * Payload:
 * {
 *   "name": "Acme SaaS Landing Page" (optional, keeps existing name if omitted),
 *   "designJson": { "body": { "style": {...}, "rows": [{ "id", "style", "columns": [{ "id", "width", "elements": [...] }] }] } }
 * }
 *
 * designJson must be the FULL replacement fully-hydrated builder schema (every row has a
 * 'columns' array of columns with an 'elements' array), validated against the same
 * TemplateJSONSchema every other publish/compile endpoint uses. compiledHtml is always
 * derived server-side from the validated designJson (and sanitized) — never trusted from
 * the caller — so the saved template can never drift from what's editable in the dashboard.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;

  const existing = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: { id: true, kind: true, name: true },
  });
  if (!existing) {
    return NextResponse.json({ error: `No template found with id "${id}" for this account.` }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const rawDesignJson = body.designJson;
  if (!rawDesignJson || typeof rawDesignJson !== "object") {
    return NextResponse.json(
      { error: "Missing required 'designJson' object representing the full replacement page layout." },
      { status: 400 }
    );
  }

  const hydrated = hydrateStructuralDefaults(rawDesignJson);
  const validation = TemplateJSONSchema.safeParse(hydrated);
  if (!validation.success) {
    return NextResponse.json(
      { error: `designJson failed schema validation: ${formatValidationIssues(validation.error)}` },
      { status: 400 }
    );
  }
  const designJson = validation.data;

  const name = body.name?.trim() || existing.name;
  if (designJson.body.style) {
    designJson.body.style.htmlTitle = designJson.body.style.htmlTitle || name;
  }

  let compiledHtml: string;
  try {
    compiledHtml = sanitizeHtml(compileToHTML(designJson));
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to compile designJson into HTML: ${err instanceof Error ? err.message : "Malformed structure"}` },
      { status: 400 }
    );
  }

  const updated = await prisma.template.update({
    where: { id: existing.id },
    data: { name, designJson, compiledHtml },
  });

  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const editableUrl = `${baseAppUrl}/dashboard/templates/${updated.id}`;

  let publishedUrl: string | null = null;
  if (existing.kind === "LANDING_PAGE") {
    const domain = await prisma.publishedDomain.findFirst({
      where: { templateId: updated.id },
      select: { domain: true },
    });
    if (domain) {
      const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
      publishedUrl = `${protocol}://${domain.domain}`;
    }
  }

  return NextResponse.json({
    success: true,
    templateId: updated.id,
    name: updated.name,
    kind: existing.kind,
    editableUrl,
    publishedUrl,
  });
}

/**
 * DELETE /api/v1/templates/:id
 *
 * Permanently deletes a template, cleaning up any Vercel Blob assets, custom domain
 * registrations in Vercel, and cascading database records (pages, publishedDomains, pageViews, assets).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["delete"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const existing = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: { id: true, name: true },
  });
  if (!existing) {
    return NextResponse.json({ error: `No template found with id "${id}" for this account.` }, { status: 404 });
  }

  // 1. Delete linked Vercel Blob storage assets
  const assets = await prisma.templateAsset.findMany({
    where: { templateId: existing.id },
    select: { blobUrl: true },
  });
  if (assets.length > 0) {
    const { del } = await import("@vercel/blob");
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    await del(assets.map((a) => a.blobUrl), blobToken ? { token: blobToken } : undefined).catch((err) =>
      console.error("Failed to delete blobs during template delete (non-fatal):", err)
    );
  }

  // 2. Remove Custom Domains from Vercel registry
  const domainsToRemove = await prisma.publishedDomain.findMany({
    where: { templateId: existing.id, type: "CUSTOM" },
    select: { domain: true },
  });
  if (domainsToRemove.length > 0) {
    const { removeVercelDomain } = await import("../../domains/route");
    for (const d of domainsToRemove) {
      await removeVercelDomain(d.domain).catch((err) =>
        console.error(`Failed to remove Vercel domain ${d.domain} during template delete (non-fatal):`, err)
      );
    }
  }

  // 3. Delete from database (cascades pages, publishedDomains, pageViews, assets)
  await prisma.template.delete({ where: { id: existing.id } });

  return NextResponse.json({
    success: true,
    deletedId: existing.id,
    name: existing.name,
    message: `Template "${existing.name}" deleted successfully.`
  });
}
