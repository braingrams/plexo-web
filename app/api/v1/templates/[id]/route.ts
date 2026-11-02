import { NextRequest, NextResponse } from "next/server";
import { SiteDeletionBlockedError, deleteTemplateAndContents } from "@/lib/sites/deleteTemplate";
import { compileToHTML } from "@/lib/compiler";
import { TemplateJSONSchema, hydrateStructuralDefaults, formatValidationIssues, sanitizeHtml } from "@/server/sanitizer";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { compileTemplateWithSiteLayout, onTemplateSaved } from "@/lib/siteLayoutDynamo";
import { snapshotTemplateRevision } from "@/lib/templateRevisions";
import { externalizeDesignSystem, resolveDesignSystem } from "@/lib/v2/designSystemStore";
import { designFormatOf, isV2Design, parseV2Design, V1_PAGE_NEEDS_CLASSIC_PAYLOAD, V2_PAGE_NEEDS_NEW_TOOLS } from "@/lib/v2/design";

import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

/**
 * GET /api/v1/templates/:id
 *
 * Fetches a single template's full details, including designJson — there was previously
 * no way for an API-key/MCP caller to read a template's content back (list_landing_pages
 * only returns metadata), which blog layout tooling needs (see plexo-mcp's getBlogLayout
 * and lib/mcp/blogTools.ts's get_blog_layout) to show the AI/user what's already designed
 * before replacing it.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${id}" for this account.` }, { status: 404 });
  }

  let publishedUrl: string | null = null;
  if (template.kind === "LANDING_PAGE") {
    const { data: domains } = await PublishedDomain.query.primary({ templateId: template.id }).go({ pages: "all" });
    if (domains[0]) {
      const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
      publishedUrl = `${protocol}://${domains[0].domain}`;
    }
  }

  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.json({
    templateId: template.id,
    name: template.name,
    kind: template.kind,
    designFormat: designFormatOf(template),
    isBlogLayout: template.isBlogLayout ?? false,
    parentTemplateId: template.parentId ?? null,
    slug: template.slug ?? null,
    designJson: await resolveDesignSystem(template.designJson),
    editableUrl: `${baseAppUrl}/dashboard/templates/${template.id}`,
    publishedUrl,
  });
}

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

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;

  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }

  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${id}" for this account.` }, { status: 404 });
  }
  if (existing.sourceType === "RAW_UPLOAD") {
    return NextResponse.json(
      { error: `"${existing.name}" was created via raw upload — use POST /api/v1/templates/${id}/replace-upload to edit its HTML instead.` },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const rawDesignJson = body.designJson;
  if (!rawDesignJson || typeof rawDesignJson !== "object") {
    return NextResponse.json(
      { error: "Missing required 'designJson' object representing the full replacement page layout." },
      { status: 400 }
    );
  }

  const format = designFormatOf(existing);
  let designJson: any;
  let compiledHtml: string;
  const name = body.name?.trim() || existing.name;

  if (format === "v2") {
    if (!isV2Design(rawDesignJson)) return NextResponse.json({ error: V2_PAGE_NEEDS_NEW_TOOLS }, { status: 400 });
    const parsed = parseV2Design(rawDesignJson);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    designJson = parsed.design;
    try {
      compiledHtml = await compileTemplateWithSiteLayout({ ...existing, name }, await resolveDesignSystem(parsed.design));
      designJson = await externalizeDesignSystem(parsed.design); // a big brand is stored once, outside the row
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "This page couldn't be built." }, { status: 400 });
    }
  } else {
    if (isV2Design(rawDesignJson)) return NextResponse.json({ error: V1_PAGE_NEEDS_CLASSIC_PAYLOAD }, { status: 400 });
    const hydrated = hydrateStructuralDefaults(rawDesignJson);
    const validation = TemplateJSONSchema.safeParse(hydrated);
    if (!validation.success) {
      return NextResponse.json(
        { error: `designJson failed schema validation: ${formatValidationIssues(validation.error)}` },
        { status: 400 }
      );
    }
    designJson = validation.data;
    if (designJson.body.style) {
      designJson.body.style.htmlTitle = designJson.body.style.htmlTitle || name;
    }
    try {
      // Email templates have always been compiled by this route with the landing-page
      // compiler and no site layout; kept byte-for-byte (email stays classic forever).
      compiledHtml =
        existing.kind === "LANDING_PAGE"
          ? await compileTemplateWithSiteLayout({ ...existing, name }, designJson)
          : sanitizeHtml(compileToHTML(designJson));
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to compile designJson into HTML: ${err instanceof Error ? err.message : "Malformed structure"}` },
        { status: 400 }
      );
    }
  }

  // Snapshot the pre-overwrite content before it's gone — never blocks or fails the save
  // itself if the revision write hiccups (see lib/templateRevisions.ts).
  void snapshotTemplateRevision(existing).catch((err) =>
    console.error(`Failed to snapshot revision for template ${existing.id} (non-fatal):`, err),
  );

  await Template.patch({ id: existing.id }).set({ name, designJson, compiledHtml }).go();
  const { data: updated } = await Template.get({ id: existing.id }).go();
  if (!updated) throw new Error(`Template ${existing.id} vanished immediately after being updated`);
  await onTemplateSaved(existing.id);

  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const editableUrl = `${baseAppUrl}/dashboard/templates/${updated.id}`;

  let publishedUrl: string | null = null;
  if (existing.kind === "LANDING_PAGE") {
    const { data: domains } = await PublishedDomain.query.primary({ templateId: updated.id }).go({ pages: "all" });
    if (domains[0]) {
      const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
      publishedUrl = `${protocol}://${domains[0].domain}`;
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
 * Permanently deletes a template and every page nested under it, cleaning up storage
 * assets and custom domain registrations. Prisma's onDelete: Cascade used to handle
 * descendant pages/assets/domains automatically at the DB level — DynamoDB has no
 * equivalent, so this walks the same cleanup the dashboard's own DELETE route
 * (app/api/templates/[id]/route.ts) already does explicitly.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["delete"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;

  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }

  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${id}" for this account.` }, { status: 404 });
  }

  try {
    await deleteTemplateAndContents(existing, resolved.organizationId);
  } catch (err) {
    if (err instanceof SiteDeletionBlockedError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }

  return NextResponse.json({
    success: true,
    deletedId: existing.id,
    name: existing.name,
    message: `Template "${existing.name}" deleted successfully.`
  });
}
