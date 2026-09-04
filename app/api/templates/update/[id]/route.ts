import { NextRequest, NextResponse } from "next/server";

import { sanitizePlexoPayload, sanitizeHtml } from "@/server/sanitizer";
import { compileToHTML } from "@/lib/compiler";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { compileWithSiteLayout, onTemplateSaved } from "@/lib/siteLayoutDynamo";
import { snapshotTemplateRevision } from "@/lib/templateRevisions";
import { Template } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

type UpdateTemplateBody = {
  designJson?: unknown;
  compiledHtml?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const params = await context.params;

  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, params.id);
    if (scopeError) return scopeError;
  }

  const body = (await request.json().catch(() => ({}))) as UpdateTemplateBody;

  let sanitizedPayload;
  try {
    sanitizedPayload = sanitizePlexoPayload({
      designJson: body.designJson,
      compiledHtml: body.compiledHtml,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Security validation failed." },
      { status: 400 }
    );
  }

  const designJson = sanitizedPayload.designJson;

  const { data: existing } = await Template.get({ id: params.id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  // The client compiled compiledHtml from its own designJson alone — it has no idea
  // whether this page's site has a shared header/footer turned on. When it does, the
  // client's compile is missing those rows, so recompute compiledHtml server-side instead
  // of trusting what was posted (same "never trust client-supplied compiledHtml" rule
  // app/api/v1/templates/[id]/route.ts already follows unconditionally). Pages on a site
  // with no active layout keep exactly the prior behavior: trust the client's compile.
  let compiledHtml = sanitizedPayload.compiledHtml;
  if (existing.kind === "LANDING_PAGE") {
    const forCompile = await compileWithSiteLayout({ id: existing.id, parentId: existing.parentId ?? null }, sanitizedPayload.designJson);
    if (forCompile !== sanitizedPayload.designJson) {
      compiledHtml = sanitizeHtml(compileToHTML(forCompile));
    }
  }

  // Snapshot the pre-overwrite content before it's gone — never blocks or fails the save
  // itself if the revision write hiccups (see lib/templateRevisions.ts).
  void snapshotTemplateRevision(existing).catch((err) =>
    console.error(`Failed to snapshot revision for template ${existing.id} (non-fatal):`, err),
  );

  await Template.patch({ id: existing.id }).set({ designJson, compiledHtml }).go();
  const { data: updated } = await Template.get({ id: existing.id }).go();
  if (!updated) throw new Error(`Template ${existing.id} vanished immediately after being updated`);

  await onTemplateSaved(existing.id);

  return NextResponse.json({
    template: {
      id: updated.id,
      updatedAt: updated.updatedAt,
    },
  });
}
