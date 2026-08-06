import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { isValidUuid } from "@/server/slug";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; categoryId: string }> },
): Promise<NextResponse> {
  const { templateId, categoryId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(categoryId)) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["delete"] });
  if (permissionError) return permissionError;

  const category = await prisma.blogCategory.findFirst({
    where: { id: categoryId, templateId: resolved.context.templateId },
    select: { id: true },
  });
  if (!category) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  // Posts keep their other categories/tags — only the join rows to this one go away.
  await prisma.blogCategory.delete({ where: { id: categoryId } });
  return NextResponse.json({ ok: true });
}
