import { BlogPost, BlogComment } from "@/lib/db/contentEntities";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuthDynamo";
import { CommentsModerationClient } from "./CommentsModerationClient";

export default async function BlogCommentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/comments`);

  // BlogComment is scoped by postId, not templateId (see its own entity comment) — no
  // direct "every comment on this site" index, so this fans out per post. A site's post
  // count is bounded in practice; a GSI3 on BlogComment is the fix if that stops holding.
  const { data: posts } = await BlogPost.query.byStatus({ templateId: access.templateId }).go();
  const postById = new Map(posts.map((p) => [p.id, p]));
  const commentBatches = await Promise.all(posts.map((p) => BlogComment.query.primary({ postId: p.id }).go()));
  const comments = commentBatches
    .flatMap((b) => b.data)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 200);

  return (
    <CommentsModerationClient
      templateId={access.templateId}
      initialComments={comments.map((c) => {
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
      })}
    />
  );
}
