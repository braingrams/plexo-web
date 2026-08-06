import { prisma } from "@/server/prisma";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuth";
import { CommentsModerationClient } from "./CommentsModerationClient";

export default async function BlogCommentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/comments`);

  const comments = await prisma.blogComment.findMany({
    where: { post: { templateId: access.templateId } },
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

  return (
    <CommentsModerationClient
      templateId={access.templateId}
      initialComments={comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
    />
  );
}
