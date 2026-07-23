import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { compileToHTML } from "@/lib/compiler";
import { TemplateJSONSchema, hydrateStructuralDefaults, formatValidationIssues, sanitizeHtml } from "@/server/sanitizer";
import { getTierFeatures } from "@/lib/subscription";
import { resolveUser } from "../../domains/route";

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

  const { id } = await context.params;

  const existing = await prisma.template.findFirst({
    where: { id, userId: resolved.userId },
    select: { id: true, kind: true, name: true },
  });
  if (!existing) {
    return NextResponse.json({ error: `No template found with id "${id}" for this account.` }, { status: 404 });
  }

  if (existing.kind === "LANDING_PAGE") {
    const features = getTierFeatures(resolved.subscriptionPlan);
    if (!features.landingPagesEnabled) {
      return NextResponse.json(
        { error: "Editing a landing page requires a PRO or ULTRA subscription plan." },
        { status: 403 }
      );
    }
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
