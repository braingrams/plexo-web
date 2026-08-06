import { NextRequest, NextResponse } from "next/server";
import { BlogCommentStatus } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");

  const comments = await prisma.blogComment.findMany({
    where: {
      post: { templateId: resolved.context.templateId },
      ...(statusFilter && statusFilter in BlogCommentStatus ? { status: statusFilter as BlogCommentStatus } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      authorName: true,
      authorEmail: true,
      body: true,
      status: true,
      createdAt: true,
      parentId: true,
      post: { select: { id: true, title: true, slug: true } },
    },
  });

  return NextResponse.json({ comments });
}
