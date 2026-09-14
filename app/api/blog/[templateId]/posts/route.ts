import { NextRequest, NextResponse } from "next/server";
import {
  BlogPost,
  BlogCategory,
  BlogAuthor,
  BlogPostCategory,
} from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { createBlogPost, type SavePostInput } from "@/lib/blog/savePostDynamo";
import { effectiveStatus } from "@/lib/blog/queriesDynamo";
import { convertWordPressHtmlToTiptapJson } from "@/lib/blogImport/htmlToTiptap";
import { assertPublishedBlogPostQuota } from "@/lib/blog/publishQuota";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");
  const search = searchParams.get("search")?.trim().toLowerCase();
  const categoryId = searchParams.get("categoryId");

  const [{ data: allPosts }, { data: categories }, { data: authors }] =
    await Promise.all([
      BlogPost.query.byStatus({ templateId: resolved.context.templateId }).go(),
      BlogCategory.query
        .primary({ templateId: resolved.context.templateId })
        .go(),
      BlogAuthor.query
        .primary({ templateId: resolved.context.templateId })
        .go(),
    ]);

  let filtered = allPosts;
  if (statusFilter) {
    filtered = filtered.filter((p) => p.status === statusFilter);
  }
  if (search) {
    filtered = filtered.filter((p) => p.title.toLowerCase().includes(search));
  }
  if (categoryId) {
    const { data: linked } = await BlogPostCategory.query
      .byCategory({ categoryId })
      .go();
    const postIdsInCategory = new Set(
      linked
        .filter((l) => l.templateId === resolved.context.templateId)
        .map((l) => l.postId),
    );
    filtered = filtered.filter((p) => postIdsInCategory.has(p.id));
  }

  filtered = [...filtered]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 200);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const authorById = new Map(authors.map((a) => [a.id, a]));
  const postCategoryBatches = await Promise.all(
    filtered.map((p) =>
      BlogPostCategory.query
        .primary({ templateId: resolved.context.templateId, postId: p.id })
        .go(),
    ),
  );

  return NextResponse.json({
    posts: filtered.map((p, i) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      status: p.status ?? "DRAFT",
      publishedAt: p.publishedAt ?? null,
      scheduledAt: p.scheduledAt ?? null,
      updatedAt: p.updatedAt ?? new Date().toISOString(),
      viewCount: p.viewCount ?? 0,
      featuredImageUrl: p.featuredImageUrl ?? null,
      author:
        p.authorId && authorById.has(p.authorId)
          ? { id: p.authorId, name: authorById.get(p.authorId)!.name }
          : null,
      categories: postCategoryBatches[i].data
        .map((pc) => categoryById.get(pc.categoryId))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ category: { id: c.id, name: c.name, slug: c.slug } })),
      effectiveStatus: effectiveStatus(
        p.status ?? "DRAFT",
        p.publishedAt ?? null,
      ),
    })),
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = requirePermission(resolved.context.role, {
    blog: ["create"],
  });
  if (permissionError) return permissionError;

  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<SavePostInput>;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  if (body.status === "PUBLISHED") {
    const quota = await assertPublishedBlogPostQuota(
      resolved.context.templateId,
      resolved.context.subscriptionPlan,
    );
    if (!quota.ok) return NextResponse.json(quota, { status: 403 });
  }

  // A caller supplying plain HTML without pre-built Tiptap/ProseMirror JSON (e.g. an
  // MCP/AI client that only knows semantic HTML, not this app's internal editor format)
  // still gets a properly editable post — same conversion the WordPress importer uses.
  const contentHtml = body.contentHtml ?? "";
  const contentJson =
    body.contentJson ??
    (contentHtml
      ? convertWordPressHtmlToTiptapJson(contentHtml)
      : { type: "doc", content: [] });

  const post = await createBlogPost(resolved.context.templateId, {
    title: body.title,
    slug: body.slug ?? null,
    excerpt: body.excerpt ?? null,
    contentJson,
    contentHtml,
    featuredImageUrl: body.featuredImageUrl ?? null,
    featuredImageAlt: body.featuredImageAlt ?? null,
    status: body.status ?? "DRAFT",
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
