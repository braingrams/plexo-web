import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { isValidUuid } from "@/server/slug";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; tagId: string }> },
): Promise<NextResponse> {
  const { templateId, tagId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(tagId)) return NextResponse.json({ error: "Tag not found." }, { status: 404 });

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["delete"] });
  if (permissionError) return permissionError;

  const tag = await prisma.blogTag.findFirst({ where: { id: tagId, templateId: resolved.context.templateId }, select: { id: true } });
  if (!tag) return NextResponse.json({ error: "Tag not found." }, { status: 404 });

  await prisma.blogTag.delete({ where: { id: tagId } });
  return NextResponse.json({ ok: true });
}
