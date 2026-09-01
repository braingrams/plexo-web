import { NextRequest, NextResponse } from "next/server";
import { BlogPost, BlogComment } from "@/lib/db/contentEntities";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");

  // BlogComment is scoped by postId, not templateId (see its own entity comment in
  // contentEntities.ts) — no direct "every comment on this site" index, so this fans out
  // per post, same as the comments moderation dashboard page.
  const { data: posts } = await BlogPost.query.byStatus({ templateId: resolved.context.templateId }).go();
  const postById = new Map(posts.map((p) => [p.id, p]));
  const commentBatches = await Promise.all(posts.map((p) => BlogComment.query.primary({ postId: p.id }).go()));
  let comments = commentBatches.flatMap((b) => b.data);
  if (statusFilter) {
    comments = comments.filter((c) => c.status === statusFilter);
  }
  comments = comments.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 200);

  return NextResponse.json({
    comments: comments.map((c) => {
      const post = postById.get(c.postId);
      return {
        id: c.id,
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        body: c.body,
        status: c.status ?? "PENDING",
        createdAt: c.createdAt ?? new Date().toISOString(),
        parentId: c.parentId ?? null,
        post: { id: c.postId, title: post?.title ?? "", slug: post?.slug ?? "" },
      };
    }),
  });
}
