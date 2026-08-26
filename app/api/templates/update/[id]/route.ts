import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { sanitizePlexoPayload, sanitizeHtml } from "@/server/sanitizer";
import { compileToHTML } from "@/lib/compiler";

import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { compileWithSiteLayout, onTemplateSaved } from "@/lib/siteLayout";

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

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const params = await context.params;
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

  const designJson = sanitizedPayload.designJson as Prisma.InputJsonValue;

  const existing = await prisma.template.findFirst({
    where: {
      id: params.id,
      organizationId: resolved.organizationId,
    },
    select: { id: true, kind: true, parentId: true },
  });

  if (!existing) {
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
    const forCompile = await compileWithSiteLayout(existing, sanitizedPayload.designJson);
    if (forCompile !== sanitizedPayload.designJson) {
      compiledHtml = sanitizeHtml(compileToHTML(forCompile));
    }
  }

  const updated = await prisma.template.update({
    where: { id: existing.id },
    data: {
      designJson,
      compiledHtml,
    },
    select: {
      id: true,
      updatedAt: true,
    },
  });
  await onTemplateSaved(existing.id);

  return NextResponse.json({
    template: {
      id: updated.id,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}
