import { NextRequest, NextResponse } from "next/server";
import {
  BlogPost,
  BlogCategory,
  BlogTag,
  BlogAuthor,
  BlogPostCategory,
  BlogPostTag,
} from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import {
  updateBlogPost,
  deleteBlogPost,
  type SavePostInput,
} from "@/lib/blog/savePostDynamo";
import { isValidUuid } from "@/server/slugDynamo";
import { convertWordPressHtmlToTiptapJson } from "@/lib/blogImport/htmlToTiptap";
import { assertPublishedBlogPostQuota } from "@/lib/blog/publishQuota";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; postId: string }> },
): Promise<NextResponse> {
  const { templateId, postId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(postId))
    return NextResponse.json({ error: "Post not found." }, { status: 404 });

  // BlogPost's primary key is (templateId, slug), not (templateId, id) — search the
  // template's posts rather than .get() directly, same as savePostDynamo.ts's findPostById.
  const { data: allPosts } = await BlogPost.query
    .byStatus({ templateId: resolved.context.templateId })
    .go();
  const post = allPosts.find((p) => p.id === postId);
  if (!post)
    return NextResponse.json({ error: "Post not found." }, { status: 404 });

  const [
    { data: categories },
    { data: tags },
    { data: authors },
    { data: postCategories },
    { data: postTags },
  ] = await Promise.all([
    BlogCategory.query
      .primary({ templateId: resolved.context.templateId })
      .go(),
    BlogTag.query.primary({ templateId: resolved.context.templateId }).go(),
    BlogAuthor.query.primary({ templateId: resolved.context.templateId }).go(),
    BlogPostCategory.query
      .primary({ templateId: resolved.context.templateId, postId })
      .go(),
    BlogPostTag.query
      .primary({ templateId: resolved.context.templateId, postId })
      .go(),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const author = post.authorId
    ? authors.find((a) => a.id === post.authorId)
    : undefined;

  return NextResponse.json({
    post: {
      ...post,
      categories: postCategories
        .map((pc) => categoryById.get(pc.categoryId))
        .filter((c): c is NonNullable<typeof c> => !!c),
      tags: postTags
        .map((pt) => tagById.get(pt.tagId))
        .filter((t): t is NonNullable<typeof t> => !!t),
      author: author
        ? { id: author.id, name: author.name, slug: author.slug }
        : null,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; postId: string }> },
): Promise<NextResponse> {
  const { templateId, postId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(postId))
    return NextResponse.json({ error: "Post not found." }, { status: 404 });

  const permissionError = requirePermission(resolved.context.role, {
    blog: ["update"],
  });
  if (permissionError) return permissionError;

  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<SavePostInput>;
  if (body.title !== undefined && !body.title.trim()) {
    return NextResponse.json(
      { error: "Title can't be empty." },
      { status: 400 },
    );
  }

  if (body.status === "PUBLISHED") {
    // Only a genuine DRAFT/SCHEDULED/ARCHIVED -> PUBLISHED transition counts against the
    // quota — an already-PUBLISHED post being re-saved shouldn't trip its own limit.
    const { data: allPosts } = await BlogPost.query
      .byStatus({ templateId: resolved.context.templateId })
      .go();
    const existing = allPosts.find((p) => p.id === postId);
    if (!existing)
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    if (existing.status !== "PUBLISHED") {
      const quota = await assertPublishedBlogPostQuota(
        resolved.context.templateId,
        resolved.context.subscriptionPlan,
      );
      if (!quota.ok) return NextResponse.json(quota, { status: 403 });
    }
  }

  // Same auto-conversion as the POST route — a caller updating contentHtml without also
  // sending pre-built contentJson (e.g. an MCP/AI client) still gets a properly editable post.
  if (body.contentHtml !== undefined && body.contentJson === undefined) {
    body.contentJson = convertWordPressHtmlToTiptapJson(body.contentHtml);
  }

  const post = await updateBlogPost(resolved.context.templateId, postId, body);
  if (!post)
    return NextResponse.json({ error: "Post not found." }, { status: 404 });

  return NextResponse.json({ post });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; postId: string }> },
): Promise<NextResponse> {
  const { templateId, postId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;
  if (!isValidUuid(postId))
    return NextResponse.json({ error: "Post not found." }, { status: 404 });

  const permissionError = requirePermission(resolved.context.role, {
    blog: ["delete"],
  });
  if (permissionError) return permissionError;

  const deleted = await deleteBlogPost(resolved.context.templateId, postId);
  if (!deleted)
    return NextResponse.json({ error: "Post not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
