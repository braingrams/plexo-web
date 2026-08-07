import { NextRequest, NextResponse } from "next/server";
import { BlogPostStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { createBlogPost, type SavePostInput } from "@/lib/blog/savePost";
import { effectiveStatus } from "@/lib/blog/queries";
import { convertWordPressHtmlToTiptapJson } from "@/lib/blogImport/htmlToTiptap";

const LIST_SELECT = {
  id: true,
  title: true,
  slug: true,
  status: true,
  publishedAt: true,
  scheduledAt: true,
  updatedAt: true,
  viewCount: true,
  featuredImageUrl: true,
  author: { select: { id: true, name: true } },
  categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
} satisfies Prisma.BlogPostSelect;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");
  const search = searchParams.get("search")?.trim();
  const categoryId = searchParams.get("categoryId");

  const where: Prisma.BlogPostWhereInput = { templateId: resolved.context.templateId };
  if (statusFilter && statusFilter in BlogPostStatus) {
    where.status = statusFilter as BlogPostStatus;
  }
  if (search) {
    where.title = { contains: search, mode: "insensitive" };
  }
  if (categoryId) {
    where.categories = { some: { categoryId } };
  }

  const posts = await prisma.blogPost.findMany({
    where,
    select: LIST_SELECT,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    posts: posts.map((p) => ({ ...p, effectiveStatus: effectiveStatus(p.status, p.publishedAt) })),
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["create"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as Partial<SavePostInput>;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  // A caller supplying plain HTML without pre-built Tiptap/ProseMirror JSON (e.g. an
  // MCP/AI client that only knows semantic HTML, not this app's internal editor format)
  // still gets a properly editable post — same conversion the WordPress importer uses.
  const contentHtml = body.contentHtml ?? "";
  const contentJson = body.contentJson ?? (contentHtml ? convertWordPressHtmlToTiptapJson(contentHtml) : { type: "doc", content: [] });

  const post = await createBlogPost(resolved.context.templateId, {
    title: body.title,
    slug: body.slug ?? null,
    excerpt: body.excerpt ?? null,
    contentJson,
    contentHtml,
    featuredImageUrl: body.featuredImageUrl ?? null,
    featuredImageAlt: body.featuredImageAlt ?? null,
    status: body.status ?? BlogPostStatus.DRAFT,
    scheduledAt: body.scheduledAt ?? null,
    metaTitle: body.metaTitle ?? null,
    metaDescription: body.metaDescription ?? null,
    ogImageUrl: body.ogImageUrl ?? null,
    noindex: body.noindex ?? false,
    authorId: body.authorId ?? null,
    categoryIds: body.categoryIds ?? [],
    tagIds: body.tagIds ?? [],
  });

  return NextResponse.json({ post }, { status: 201 });
}
