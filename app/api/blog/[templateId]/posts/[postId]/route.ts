import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { updateBlogPost, deleteBlogPost, type SavePostInput } from "@/lib/blog/savePost";
import { isValidUuid } from "@/server/slug";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; postId: string }> },
): Promise<NextResponse> {
  const { templateId, postId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(postId)) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  const post = await prisma.blogPost.findFirst({
    where: { id: postId, templateId: resolved.context.templateId },
    include: {
      categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
      tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
      author: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  return NextResponse.json({ post });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; postId: string }> },
): Promise<NextResponse> {
  const { templateId, postId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(postId)) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as Partial<SavePostInput>;
  if (body.title !== undefined && !body.title.trim()) {
    return NextResponse.json({ error: "Title can't be empty." }, { status: 400 });
  }

  const post = await updateBlogPost(resolved.context.templateId, postId, body);
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  return NextResponse.json({ post });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; postId: string }> },
): Promise<NextResponse> {
  const { templateId, postId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(postId)) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["delete"] });
  if (permissionError) return permissionError;

  const deleted = await deleteBlogPost(resolved.context.templateId, postId);
  if (!deleted) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
