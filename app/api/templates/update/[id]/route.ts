import { NextRequest, NextResponse } from "next/server";

import { sanitizePlexoPayload } from "@/server/sanitizer";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { Template } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { compileTemplateWithSiteLayout } from "@/lib/siteLayoutDynamo";
import { designFormatOf, parseV2Design } from "@/lib/v2/design";
import { externalizeDesignSystem, resolveDesignSystem } from "@/lib/v2/designSystemStore";

type UpdateTemplateBody = {
  designJson?: unknown;
  compiledHtml?: string;
};

/**
 * POST /api/templates/update/:id
 *
 * Persists the editor's autosave/Save-button state as this template's working DRAFT —
 * draftJson/draftHtml (lib/db/contentEntities.ts) — never the live designJson/compiledHtml
 * fields app/pub actually serves. Nothing here goes live until a real
 * POST /api/templates/:id/publish call (lib/templateVersions.ts's publishTemplateDraft),
 * so there's no site-layout recompile or onTemplateSaved cache-bust to do here either —
 * both only matter for content that's actually being served.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, {
    template: ["update"],
  });
  if (permissionError) return permissionError;

  const params = await context.params;

  if (resolved.role !== null) {
    const { data: member } = await Member.get({
      organizationId: resolved.organizationId,
      userId: resolved.userId,
    }).go();
    const scopeError = requireTemplateScope(member, params.id);
    if (scopeError) return scopeError;
  }

  const body = (await request.json().catch(() => ({}))) as UpdateTemplateBody;

  const { data: existing } = await Template.get({ id: params.id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  let sanitizedPayload: { designJson: unknown; compiledHtml: string };
  if (designFormatOf(existing) === "v2") {
    // New-editor pages: validate the V2 payload and compile the draft preview on the server
    // (never trust a client-sent compiledHtml, and never run V2 output through V1's sanitiser).
    const parsed = parseV2Design(body.designJson);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    let draftHtml: string;
    let stored: typeof parsed.design;
    try {
      // The page is built with the real brand (loaded if it's a reference), and stored with a big brand moved out of the row.
      draftHtml = await compileTemplateWithSiteLayout(existing, await resolveDesignSystem(parsed.design));
      stored = await externalizeDesignSystem(parsed.design);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "This page couldn't be built." }, { status: 400 });
    }
    sanitizedPayload = { designJson: stored, compiledHtml: draftHtml };
  } else {
    try {
      sanitizedPayload = sanitizePlexoPayload({
        designJson: body.designJson,
        compiledHtml: body.compiledHtml,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "Security validation failed.",
        },
        { status: 400 },
      );
    }
  }

  await Template.patch({ id: existing.id })
    .set({
      draftJson: sanitizedPayload.designJson,
      draftHtml: sanitizedPayload.compiledHtml,
    })
    .go();
  const { data: updated } = await Template.get({ id: existing.id }).go();
  if (!updated)
    throw new Error(
      `Template ${existing.id} vanished immediately after being updated`,
    );

  return NextResponse.json({
    template: {
      id: updated.id,
      updatedAt: updated.updatedAt,
    },
  });
}
