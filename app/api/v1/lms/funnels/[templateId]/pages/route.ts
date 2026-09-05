import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";
import { LmsPage } from "@/lib/db/contentEntities";
import { defaultUnlockRules } from "@/lib/lms/rules";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: pages } = await LmsPage.query.byOrder({ templateId }).go({ pages: "all" });
  return NextResponse.json({ pages });
}

// New pages always default to VIDEO (the most common Udemy-style case) and the
// zero-config "unlocks after the previous page" rule — see lib/lms/rules.ts's
// defaultUnlockRules. Appended to the end of the list; reordering is a separate endpoint.
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["create"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { title?: string; kind?: string };
  const kind = body.kind === "WELCOME" || body.kind === "DOCUMENT" || body.kind === "IMAGE" ? body.kind : "VIDEO";

  const { data: existingPages } = await LmsPage.query.byOrder({ templateId }).go({ pages: "all" });
  const nextOrder = existingPages.length;
  const previousPage = existingPages[existingPages.length - 1];

  const id = randomUUID();
  await LmsPage.create({
    id,
    templateId,
    organizationId,
    order: nextOrder,
    kind,
    title: body.title?.trim() || `Page ${nextOrder + 1}`,
    unlockRules: defaultUnlockRules(previousPage?.id ?? null),
  }).go();

  const { data: page } = await LmsPage.get({ templateId, id }).go();
  return NextResponse.json({ page }, { status: 201 });
}
