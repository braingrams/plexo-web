import type { EntityItem } from "electrodb";
import type { BlogPost } from "@/lib/db/contentEntities";
import { revalidateBlogPost } from "./revalidateDynamo";
import {
  createBlogPost as createBlogPostCore,
  updateBlogPost as updateBlogPostCore,
  deleteBlogPost as deleteBlogPostCore,
  findPostByExternalId,
  type SavePostInput,
} from "./savePostCore";

// The actual DynamoDB read/write logic (plus findPostByExternalId) now lives in
// lib/blog/savePostCore.ts (no `next/cache` import there) so lib/mcp/blogTools.ts —
// reachable from SOL's standalone Lambda bundle (lambda/sol-chat/index.ts) — can use it
// without pulling next/cache (and the "@opentelemetry/api" resolution failure it
// transitively causes when esbuild-bundled standalone) into that bundle. This file re-binds
// the real revalidateBlogPost (which DOES need next/cache — it calls Next's revalidatePath)
// as savePostCore's injected `revalidate` callback, so createBlogPost/updateBlogPost/
// deleteBlogPost keep their exact original (templateId, input) signature and behavior for
// every existing production call site (app/api/blog/**, lib/siteImport/**,
// lib/blogImport/**) — completely unchanged. See savePostCore.ts's own top-of-file comment
// for the full story.
export type { SavePostInput };
export { findPostByExternalId };

type BlogPostItem = EntityItem<typeof BlogPost>;

export async function createBlogPost(templateId: string, input: SavePostInput): Promise<BlogPostItem> {
  return createBlogPostCore(templateId, input, revalidateBlogPost);
}

export async function updateBlogPost(templateId: string, postId: string, input: Partial<SavePostInput>): Promise<BlogPostItem | null> {
  return updateBlogPostCore(templateId, postId, input, revalidateBlogPost);
}

export async function deleteBlogPost(templateId: string, postId: string): Promise<boolean> {
  return deleteBlogPostCore(templateId, postId, revalidateBlogPost);
}
