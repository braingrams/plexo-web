import { Template, BlogPost } from "@/lib/db/contentEntities";
import { updateBlogPost } from "@/lib/blog/savePostDynamo";

/** Literal string substitution — same technique already established by lib/blogImport/mediaRehost.ts's rewriteImageUrls for rewriting URLs inside stored HTML. */
function rewriteHtmlLinks(html: string, urlMap: Record<string, string>): string {
  let result = html;
  for (const [sourceUrl, newPath] of Object.entries(urlMap)) {
    result = result.split(sourceUrl).join(newPath);
  }
  return result;
}

interface TiptapNode {
  type?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: TiptapNode[];
}

/** Walks a Tiptap/ProseMirror doc tree rewriting href (link marks) and src (image nodes) — contentJson is the round-tripped source of truth the editor saves from, so rewriting only contentHtml would silently revert on the next editor save. */
function rewriteTiptapJsonLinks(node: TiptapNode, urlMap: Record<string, string>): TiptapNode {
  const next: TiptapNode = { ...node };

  if (next.type === "image" && next.attrs?.src && typeof next.attrs.src === "string" && urlMap[next.attrs.src]) {
    next.attrs = { ...next.attrs, src: urlMap[next.attrs.src] };
  }
  if (next.marks) {
    next.marks = next.marks.map((mark) => {
      if (mark.type === "link" && mark.attrs?.href && typeof mark.attrs.href === "string" && urlMap[mark.attrs.href]) {
        return { ...mark, attrs: { ...mark.attrs, href: urlMap[mark.attrs.href] } };
      }
      return mark;
    });
  }
  if (next.content) {
    next.content = next.content.map((child) => rewriteTiptapJsonLinks(child, urlMap));
  }
  return next;
}

/**
 * Rewrites one already-imported page/post's internal links from the source site's absolute
 * URLs to the new relative Plexo paths, using the job's urlMap (only entries for pages that
 * were themselves successfully imported — a link to a discovered-but-failed/excluded page has
 * no urlMap entry, so it's simply left untouched, pointing at the original external URL rather
 * than becoming a broken relative link). Safe to call once per page; caller marks
 * SiteImportPage.rewrittenAt after this succeeds.
 *
 * Takes jobTemplateId (the site's own root Template, always known to the caller) in
 * addition to pageTemplateId/blogPostId — unlike Prisma's globally-unique BlogPost.id,
 * BlogPost's real key is (templateId, slug) (see contentEntities.ts), so a blog-post
 * lookup by bare id needs the site's templateId to know which partition to search.
 */
export async function rewriteLinksForPage(
  jobTemplateId: string,
  pageTemplateId: string | null,
  blogPostId: string | null,
  urlMap: Record<string, string>,
): Promise<void> {
  if (pageTemplateId) {
    const { data: template } = await Template.get({ id: pageTemplateId }).go();
    if (!template) return;
    const rewritten = rewriteHtmlLinks(template.compiledHtml, urlMap);
    if (rewritten !== template.compiledHtml) {
      await Template.patch({ id: pageTemplateId }).set({ compiledHtml: rewritten }).go();
    }
    return;
  }

  if (blogPostId) {
    const { data: posts } = await BlogPost.query.byStatus({ templateId: jobTemplateId }).go();
    const post = posts.find((p) => p.id === blogPostId);
    if (!post) return;
    const contentHtml = rewriteHtmlLinks(post.contentHtml, urlMap);
    const contentJson = rewriteTiptapJsonLinks(post.contentJson as TiptapNode, urlMap);
    // Goes through updateBlogPost (not a raw patch) to preserve the sanitize-on-every-write invariant lib/blog/sanitize.ts requires.
    await updateBlogPost(jobTemplateId, blogPostId, { contentHtml, contentJson });
  }
}
