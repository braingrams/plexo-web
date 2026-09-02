import { BlogPost, BlogComment } from "@/lib/db/contentEntities";
import type { EntityItem } from "electrodb";

type CommentItem = EntityItem<typeof BlogComment>;

/** BlogComment's primary key is (postId, status#createdAt#id) — finding "this comment
 * by id, somewhere in this site" needs the postId first, which callers here don't have.
 * Fans out across the template's posts, same bound as the moderation list/GET route. */
export async function findCommentById(templateId: string, commentId: string): Promise<CommentItem | null> {
  const { data: posts } = await BlogPost.query.byStatus({ templateId }).go();
  const batches = await Promise.all(posts.map((p) => BlogComment.query.primary({ postId: p.id }).go()));
  return batches.flatMap((b) => b.data).find((c) => c.id === commentId) ?? null;
}

/** Every reply to `commentId` within the same post, recursively — Prisma's onDelete:
 * Cascade on parentId had no DynamoDB equivalent, so a comment delete has to walk this
 * itself before removing the comment. */
export async function getDescendantCommentIds(postId: string, commentId: string): Promise<CommentItem[]> {
  const { data: allComments } = await BlogComment.query.primary({ postId }).go();
  const result: CommentItem[] = [];
  let frontier = [commentId];
  while (frontier.length > 0) {
    const children = allComments.filter((c) => c.parentId && frontier.includes(c.parentId));
    result.push(...children);
    frontier = children.map((c) => c.id);
  }
  return result;
}
