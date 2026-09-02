import { randomUUID } from "node:crypto";
import { compileToHTML } from "@/lib/compiler";
import { TemplateJSONSchema, hydrateStructuralDefaults, formatValidationIssues, sanitizeHtml } from "@/server/sanitizer";
import { resolveUser } from "@/lib/auth/resolveUser";
import { createBlogPost, updateBlogPost, deleteBlogPost } from "@/lib/blog/savePostDynamo";
import { generateUniqueAuthorSlug } from "@/lib/blog/authorsDynamo";
import { effectiveStatus } from "@/lib/blog/queriesDynamo";
import { findCommentById, getDescendantCommentIds } from "@/lib/blog/commentsDynamo";
import { slugify, avoidPageReservedSlug, isValidUuid } from "@/server/slugDynamo";
import { convertWordPressHtmlToTiptapJson } from "@/lib/blogImport/htmlToTiptap";
import { FONT_PRESET_OPTIONS } from "@/lib/pub/blogTheme";
import { hasBlogMarker, type BlogMarkerName } from "@/lib/pub/blogLayoutRender";
import { Template, BlogSite, BlogCategory, BlogTag, BlogAuthor, BlogPost, BlogPostCategory, BlogPostTag, BlogComment } from "@/lib/db/contentEntities";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

const BLOG_POST_STATUSES = new Set(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]);
const BLOG_COMMENT_STATUSES = new Set(["PENDING", "APPROVED", "SPAM", "REJECTED"]);

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const VALID_FONT_PRESETS = new Set(FONT_PRESET_OPTIONS.map((o) => o.value));

const BLOG_SCHEMA_HINT =
  "Every row must already be a fully hydrated layout: { id, style, columns: [{ id, width, elements: [{ id, type, style, attributes }] }] }. " +
  "See design_blog_layout's description for a full worked example, including the required blog_* marker element for this layout kind.";

/** Same validation every other builder-writing MCP tool applies (see mcpServer.ts's own
 * validateDesignJson) — kept as a separate copy here rather than shared, to avoid a
 * circular import between this file and mcpServer.ts. */
function validateBlogDesignJson(rawDesignJson: any): any {
  const hydrated = hydrateStructuralDefaults(rawDesignJson);
  const validation = TemplateJSONSchema.safeParse(hydrated);
  if (!validation.success) {
    throw new Error(`designJson failed schema validation: ${formatValidationIssues(validation.error)}. ${BLOG_SCHEMA_HINT}`);
  }
  return validation.data;
}

/** Every blog tool is scoped to a "site" — a root Template (parentId === null) owned by
 * the caller's organization, the same row PublishedDomain/BlogSite point at. */
async function resolveBlogSiteId(resolved: ResolvedUser, templateId: unknown): Promise<string> {
  const trimmed = typeof templateId === "string" ? templateId.trim() : "";
  if (!trimmed) {
    throw new Error("templateId is required — pass the site's home page id (see list_landing_pages).");
  }
  const { data: site } = await Template.get({ id: trimmed }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    throw new Error(
      `No site found with id "${trimmed}" in this account. templateId must be a site's home page (no parent) — use list_landing_pages to find it.`
    );
  }
  return site.id;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Resolves author NAME (not id) to a BlogAuthor id, creating a new guest byline if no
 * existing author matches — same ergonomics as the dashboard's post editor, since an AI
 * client calling this tool has no way to already know internal author UUIDs. */
async function resolveAuthorId(templateId: string, authorName: unknown): Promise<string | null | undefined> {
  if (authorName === undefined) return undefined;
  if (authorName === null) return null;
  const name = String(authorName).trim();
  if (!name) return null;
  const { data: authors } = await BlogAuthor.query.primary({ templateId }).go();
  const existing = authors.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const slug = await generateUniqueAuthorSlug(templateId, name);
  const id = randomUUID();
  await BlogAuthor.create({ id, templateId, name, slug }).go();
  return id;
}

async function resolveCategoryIds(templateId: string, names: string[] | undefined): Promise<string[] | undefined> {
  if (names === undefined) return undefined;
  const { data: categories } = await BlogCategory.query.primary({ templateId }).go();
  const ids: string[] = [];
  for (const name of names) {
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const baseSlug = avoidPageReservedSlug(slugify(name) || "category", "category");
    let slug = baseSlug;
    let suffix = 2;
    while ((await BlogCategory.get({ templateId, slug }).go()).data) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const id = randomUUID();
    await BlogCategory.create({ id, templateId, name, slug }).go();
    ids.push(id);
    categories.push({ id, templateId, name, slug } as any); // keep in-memory list consistent for later duplicate names in the same call
  }
  return ids;
}

async function resolveTagIds(templateId: string, names: string[] | undefined): Promise<string[] | undefined> {
  if (names === undefined) return undefined;
  const { data: tags } = await BlogTag.query.primary({ templateId }).go();
  const ids: string[] = [];
  for (const name of names) {
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const baseSlug = avoidPageReservedSlug(slugify(name) || "tag", "tag");
    let slug = baseSlug;
    let suffix = 2;
    while ((await BlogTag.get({ templateId, slug }).go()).data) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const id = randomUUID();
    await BlogTag.create({ id, templateId, name, slug }).go();
    ids.push(id);
    tags.push({ id, templateId, name, slug } as any);
  }
  return ids;
}

type LayoutKind = "post" | "listing";
function isLayoutKind(value: unknown): value is LayoutKind {
  return value === "post" || value === "listing";
}

/** Mirrors app/api/blog/[templateId]/layout/[kind]/route.ts's POST — idempotent: returns
 * the existing layout template if one's already attached rather than creating a duplicate. */
async function ensureBlogLayoutTemplate(resolved: ResolvedUser, siteId: string, kind: LayoutKind): Promise<string> {
  const { data: site } = await BlogSite.get({ templateId: siteId }).go();
  const existingId = kind === "post" ? site?.postLayoutTemplateId : site?.listingLayoutTemplateId;
  if (existingId) return existingId;

  const layoutId = randomUUID();
  await Template.create({
    id: layoutId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    name: kind === "post" ? "Blog Post Layout" : "Blog Listing Layout",
    kind: "LANDING_PAGE",
    isBlogLayout: true,
    designJson: { body: { style: { background: "#ffffff", padding: "24px" }, rows: [] } },
    compiledHtml: "",
  }).go();

  const layoutField = kind === "post" ? { postLayoutTemplateId: layoutId } : { listingLayoutTemplateId: layoutId };
  if (site) {
    await BlogSite.patch({ templateId: siteId }).set(layoutField).go();
  } else {
    await BlogSite.create({ id: randomUUID(), templateId: siteId, ...layoutField }).go();
  }

  return layoutId;
}

const BLOG_LAYOUT_EXAMPLE = `
EXAMPLE — a single-post layout with a hero image, title, meta line, and content:
{
  "body": {
    "style": { "backgroundColor": "#ffffff", "color": "#1e293b", "fontFamily": "Inter, sans-serif", "htmlTitle": "Blog Post" },
    "rows": [
      { "id": "row-hero", "style": { "paddingTop": "0px" }, "columns": [
        { "id": "col-hero", "width": "100%", "elements": [
          { "id": "el-featured", "type": "blog_featured_image", "style": { "width": "100%", "maxHeight": "420px", "objectFit": "cover" }, "attributes": {} }
        ] }
      ] },
      { "id": "row-meta", "style": { "paddingTop": "32px", "paddingBottom": "8px" }, "columns": [
        { "id": "col-title", "width": "100%", "elements": [
          { "id": "el-title", "type": "blog_title", "style": { "fontSize": "40px", "fontWeight": "800" }, "attributes": {} },
          { "id": "el-authordate", "type": "blog_author", "style": { "fontSize": "14px", "color": "#64748b", "display": "inline-block", "marginRight": "12px" }, "attributes": {} },
          { "id": "el-date", "type": "blog_date", "style": { "fontSize": "14px", "color": "#64748b", "display": "inline-block" }, "attributes": {} }
        ] }
      ] },
      { "id": "row-body", "style": { "paddingTop": "24px", "paddingBottom": "48px" }, "columns": [
        { "id": "col-body", "width": "100%", "elements": [
          { "id": "el-content", "type": "blog_content", "style": { "fontSize": "17px", "lineHeight": "1.7" }, "attributes": {} },
          { "id": "el-comments", "type": "blog_comments", "style": { "marginTop": "48px" }, "attributes": {} }
        ] }
      ] }
    ]
  }
}

EXAMPLE — a listing layout with a 3-column post grid:
{
  "body": {
    "style": { "backgroundColor": "#ffffff", "color": "#1e293b", "fontFamily": "Inter, sans-serif", "htmlTitle": "Blog" },
    "rows": [
      { "id": "row-heading", "style": { "paddingTop": "48px", "paddingBottom": "16px" }, "columns": [
        { "id": "col-heading", "width": "100%", "elements": [
          { "id": "el-heading", "type": "heading", "style": { "fontSize": "36px", "fontWeight": "800", "textAlign": "center" }, "attributes": { "text": "Latest Posts" } }
        ] }
      ] },
      { "id": "row-list", "style": { "paddingBottom": "48px" }, "columns": [
        { "id": "col-list", "width": "100%", "elements": [
          { "id": "el-postlist", "type": "blog_post_list", "style": { "gridColumns": "3" }, "attributes": {} }
        ] }
      ] }
    ]
  }
}`;

export const BLOG_MCP_TOOLS = [
  {
    name: "get_blog_layout",
    description: `Fetches a blog site's current custom layout (its designJson) for either the single-post page or the listing/index page — or reports that none has been designed yet (the site falls back to the default built-in blog theme until one is). Call this BEFORE design_blog_layout if you want to edit an existing layout rather than start blank, since design_blog_layout replaces the ENTIRE designJson.`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id (a root/parentless landing page — see list_landing_pages). BlogSite rows are always scoped to this id, never a sub-page." },
        kind: { type: "string", enum: ["post", "listing"], description: "Which layout to fetch: 'post' for the single blog post page, 'listing' for the blog index/archive page." },
      },
      required: ["templateId", "kind"],
    },
  },
  {
    name: "design_blog_layout",
    description: `Designs (creates if none exists yet, or fully replaces if one does) the custom builder layout for a blog site's single-post page or listing/index page. This is how the AI can give a blog its own branded look instead of the default built-in theme.

Uses the SAME fully-hydrated layout schema as publish_landing_page (rows/columns/elements) — designJson MUST be { "body": { "style": {...}, "rows": [...] } }, no shorthand. In addition to the ordinary element types, this layout may (and for the required one below, MUST) use these blog placeholder marker types, each resolved per-post/per-listing at render time and never carrying real content or meaningful attributes (still include "attributes": {}):
- blog_title, blog_content, blog_featured_image, blog_date, blog_author, blog_categories, blog_comments — for kind 'post' only. blog_content is REQUIRED (the layout is otherwise ignored and the site falls back to the default theme) and should appear exactly once; blog_title should also normally appear exactly once; the rest are optional, usually single-use.
- blog_post_list — for kind 'listing' only. This is REQUIRED for a listing layout (same fallback behavior if missing) and is the ONLY blog placeholder valid on this kind — it renders the whole paginated grid/list of posts itself, so blog_title/blog_content/etc. do not belong on a listing layout.
This replaces the ENTIRE designJson — call get_blog_layout first to fetch the current one if you want to edit rather than replace.
${BLOG_LAYOUT_EXAMPLE}`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id (see list_landing_pages)." },
        kind: { type: "string", enum: ["post", "listing"], description: "Which layout to design: 'post' for the single blog post page, 'listing' for the blog index/archive page." },
        name: { type: "string", description: "Optional name for the underlying layout template (shown in the dashboard). Defaults to 'Blog Post Layout'/'Blog Listing Layout'." },
        designJson: {
          type: "object",
          description: "The FULL Plexo layout schema — see this tool's description for the required marker element and a worked example per kind.",
          required: ["body"],
        },
      },
      required: ["templateId", "kind", "designJson"],
    },
  },
  {
    name: "reset_blog_layout",
    description: "Detaches a blog site's custom post or listing layout, reverting it to the default built-in blog theme. The layout Template itself is NOT deleted — it stays editable and can be reattached later by calling design_blog_layout again (which reuses it rather than creating a new one).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        kind: { type: "string", enum: ["post", "listing"], description: "Which layout to detach." },
      },
      required: ["templateId", "kind"],
    },
  },
  {
    name: "get_blog_settings",
    description: "Fetches a blog site's settings: whether the blog is enabled/live, its title/description, posts-per-page, whether it replaces the site's homepage, and its appearance (accent color, font preset, logo, header image, comments toggle).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "update_blog_settings",
    description: "Updates a blog site's settings. The blog is NOT publicly visible at /blog until 'enabled' is set to true — call this with enabled: true before publishing posts if the user wants the blog live. Only the fields provided are changed; omit any field to leave it as-is.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        enabled: { type: "boolean", description: "Whether the blog is publicly visible at /blog." },
        title: { type: "string", description: "Blog title (shown in headers/SEO)." },
        description: { type: "string", description: "Blog description/tagline." },
        postsPerPage: { type: "number", description: "Posts per listing page, 1-50." },
        showOnHomepage: { type: "boolean", description: "If true, the blog listing replaces the site's own root page ('/') instead of living at '/blog'." },
        accentColor: { type: "string", description: "Hex accent color for the default theme (e.g. '#6d28d9'). Ignored if a custom design_blog_layout has been designed." },
        fontPreset: { type: "string", enum: ["sans", "serif", "modern", "elegant"], description: "Font preset for the default theme." },
        logoUrl: { type: "string", description: "Logo image URL for the default theme." },
        headerImageUrl: { type: "string", description: "Header/banner image URL for the default theme." },
        commentsEnabled: { type: "boolean", description: "Sitewide comments master switch (a post's own commentsEnabled must also be true for its comments to show)." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "list_blog_posts",
    description: "Lists a blog site's posts (up to 200, most recently updated first), with optional status/search/category filters.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        status: { type: "string", enum: ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"], description: "Optional status filter." },
        search: { type: "string", description: "Optional case-insensitive title search." },
        categorySlug: { type: "string", description: "Optional category slug filter (see list_blog_categories)." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "get_blog_post",
    description: "Fetches one blog post's full details (content, SEO fields, categories, tags, author) by id or slug.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        postId: { type: "string", description: "The post's id. Provide this or slug." },
        slug: { type: "string", description: "The post's URL slug. Provide this or postId." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "create_blog_post",
    description: `Creates and saves a new blog post. Content is written as plain semantic HTML (contentHtml) — <p>, <h2>-<h4>, <ul>/<ol>/<li>, <a href>, <img src alt>, <strong>, <em>, <blockquote> — NOT raw ProseMirror/Tiptap JSON; the server converts it automatically. A DRAFT post is saved but not publicly visible until its status is PUBLISHED (or the blog itself isn't enabled yet — see update_blog_settings) — set status to "PUBLISHED" to publish immediately, or omit it to save as a draft.

categoryNames/tagNames/authorName are plain names, not ids — matching ones are reused, unmatched ones are created automatically (same as typing a new category/tag/author into the dashboard editor). Use list_blog_categories/list_blog_tags/list_blog_authors first only if you need to see what already exists.`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        title: { type: "string", description: "Post title." },
        slug: { type: "string", description: "Optional URL slug. Auto-generated from the title if omitted; auto-suffixed on collision." },
        excerpt: { type: "string", description: "Optional short summary shown on the listing page. Auto-generated from content if omitted." },
        contentHtml: { type: "string", description: "Post body as semantic HTML (see this tool's description for supported tags)." },
        featuredImageUrl: { type: "string", description: "Optional featured/hero image URL." },
        featuredImageAlt: { type: "string", description: "Optional alt text for the featured image." },
        status: { type: "string", enum: ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"], description: "Defaults to DRAFT if omitted." },
        scheduledAt: { type: "string", description: "ISO datetime to auto-publish at — only used when status is SCHEDULED." },
        metaTitle: { type: "string", description: "Optional SEO meta title. Falls back to the post title." },
        metaDescription: { type: "string", description: "Optional SEO meta description. Falls back to the excerpt." },
        ogImageUrl: { type: "string", description: "Optional Open Graph share image URL. Falls back to the featured image." },
        noindex: { type: "boolean", description: "If true, adds a noindex meta tag (hides the post from search engines)." },
        authorName: { type: "string", description: "Optional byline name — reused if an author with this name exists, created otherwise." },
        categoryNames: { type: "array", items: { type: "string" }, description: "Optional category names — reused/created as needed." },
        tagNames: { type: "array", items: { type: "string" }, description: "Optional tag names — reused/created as needed." },
      },
      required: ["templateId", "title"],
    },
  },
  {
    name: "update_blog_post",
    description: "Edits an existing blog post in place. Only the fields provided are changed — omit any field to leave it as-is. Same contentHtml/categoryNames/tagNames/authorName conventions as create_blog_post (plain HTML in, names not ids).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        postId: { type: "string", description: "The post to update." },
        title: { type: "string" },
        slug: { type: "string" },
        excerpt: { type: "string" },
        contentHtml: { type: "string", description: "Post body as semantic HTML — replaces the entire body if provided." },
        featuredImageUrl: { type: "string" },
        featuredImageAlt: { type: "string" },
        status: { type: "string", enum: ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] },
        scheduledAt: { type: "string", description: "ISO datetime — only used when status is SCHEDULED." },
        metaTitle: { type: "string" },
        metaDescription: { type: "string" },
        ogImageUrl: { type: "string" },
        noindex: { type: "boolean" },
        authorName: { type: "string", description: "Byline name — reused/created as needed." },
        categoryNames: { type: "array", items: { type: "string" }, description: "FULL replacement category list — reused/created as needed." },
        tagNames: { type: "array", items: { type: "string" }, description: "FULL replacement tag list — reused/created as needed." },
      },
      required: ["templateId", "postId"],
    },
  },
  {
    name: "delete_blog_post",
    description: "Permanently deletes a blog post. Cannot be undone — confirm with the user first.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        postId: { type: "string", description: "The post to delete." },
      },
      required: ["templateId", "postId"],
    },
  },
  {
    name: "list_blog_categories",
    description: "Lists a blog site's categories.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The blog site's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "create_blog_category",
    description: "Creates a blog category. Categories/tags/authors are usually better created implicitly via create_blog_post/update_blog_post's categoryNames — use this directly only when you need to set up a category (e.g. with a parent) before any post references it.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        name: { type: "string", description: "Category name." },
        description: { type: "string", description: "Optional category description." },
        parentName: { type: "string", description: "Optional parent category name, to nest this under it." },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "delete_blog_category",
    description: "Deletes a blog category. Posts keep their other categories/tags — only this category's assignment goes away.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        categoryId: { type: "string", description: "The category's id. Provide this or name." },
        name: { type: "string", description: "The category's name (case-insensitive). Provide this or categoryId." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "list_blog_tags",
    description: "Lists a blog site's tags.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The blog site's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "create_blog_tag",
    description: "Creates a blog tag. Usually better created implicitly via create_blog_post/update_blog_post's tagNames — use this directly only when you need the tag to exist before any post references it.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        name: { type: "string", description: "Tag name." },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "delete_blog_tag",
    description: "Deletes a blog tag. Posts keep their other tags — only this tag's assignment goes away.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        tagId: { type: "string", description: "The tag's id. Provide this or name." },
        name: { type: "string", description: "The tag's name (case-insensitive). Provide this or tagId." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "list_blog_authors",
    description: "Lists a blog site's authors/bylines.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The blog site's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "create_blog_author",
    description: "Creates a blog author/byline (a guest byline, not a login-capable account — WordPress-style). Usually better created implicitly via create_blog_post/update_blog_post's authorName — use this directly only when you need to set a bio/avatar before any post references it.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        name: { type: "string", description: "Author display name." },
        bio: { type: "string", description: "Optional author bio." },
        avatarUrl: { type: "string", description: "Optional avatar image URL." },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "delete_blog_author",
    description: "Deletes a blog author. Their posts are kept — they just lose the byline (same as removing a category/tag).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        authorId: { type: "string", description: "The author's id. Provide this or name." },
        name: { type: "string", description: "The author's name (case-insensitive). Provide this or authorId." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "list_blog_comments",
    description: "Lists a blog site's comments (up to 200, most recent first), across all posts. Every comment starts PENDING and is invisible to visitors until moderated APPROVED.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        status: { type: "string", enum: ["PENDING", "APPROVED", "SPAM", "REJECTED"], description: "Optional status filter." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "moderate_blog_comment",
    description: "Approves, rejects, or marks a comment as spam (or resets it to pending).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        commentId: { type: "string", description: "The comment to moderate." },
        status: { type: "string", enum: ["PENDING", "APPROVED", "SPAM", "REJECTED"], description: "New moderation status." },
      },
      required: ["templateId", "commentId", "status"],
    },
  },
  {
    name: "delete_blog_comment",
    description: "Permanently deletes a comment (and any replies nested under it, cascading).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page template id." },
        commentId: { type: "string", description: "The comment to delete." },
      },
      required: ["templateId", "commentId"],
    },
  },
];

export const BLOG_TOOL_NAMES = new Set(BLOG_MCP_TOOLS.map((t) => t.name));

export async function handleBlogTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

  switch (toolName) {
    case "get_blog_layout": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      if (!isLayoutKind(args.kind)) throw new Error('kind must be "post" or "listing".');
      const kind = args.kind;

      const { data: site } = await BlogSite.get({ templateId: siteId }).go();
      const layoutTemplateId = kind === "post" ? site?.postLayoutTemplateId : site?.listingLayoutTemplateId;
      if (!layoutTemplateId) {
        return {
          exists: false,
          kind,
          message: "No custom layout designed yet for this kind — call design_blog_layout to create one (the site uses the default built-in theme until then).",
        };
      }

      const { data: layout } = await Template.get({ id: layoutTemplateId }).go();
      if (!layout) {
        return { exists: false, kind, message: "The linked layout template no longer exists — call design_blog_layout to create a new one." };
      }

      const requiredMarker: BlogMarkerName = kind === "post" ? "content" : "postList";
      return {
        exists: true,
        kind,
        layoutTemplateId: layout.id,
        name: layout.name,
        designJson: layout.designJson,
        hasRequiredMarker: hasBlogMarker(layout.compiledHtml, requiredMarker),
        editableUrl: `${baseAppUrl}/dashboard/templates/${layout.id}`,
      };
    }

    case "design_blog_layout": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      if (!isLayoutKind(args.kind)) throw new Error('kind must be "post" or "listing".');
      const kind = args.kind;

      let rawDesignJson = args.designJson;
      if (typeof rawDesignJson === "string") {
        try {
          rawDesignJson = JSON.parse(rawDesignJson);
        } catch {
          rawDesignJson = null;
        }
      }
      if (!rawDesignJson || typeof rawDesignJson !== "object") {
        throw new Error("designJson object is required to design a blog layout.");
      }

      const designJson = validateBlogDesignJson(rawDesignJson);
      const compiledHtml = sanitizeHtml(compileToHTML(designJson));

      const layoutTemplateId = await ensureBlogLayoutTemplate(resolved, siteId, kind);
      const requiredMarker: BlogMarkerName = kind === "post" ? "content" : "postList";
      const hasRequired = hasBlogMarker(compiledHtml, requiredMarker);

      const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : undefined;
      await Template.patch({ id: layoutTemplateId }).set({ designJson, compiledHtml, ...(name ? { name } : {}) }).go();

      return {
        success: true,
        layoutTemplateId,
        kind,
        editableUrl: `${baseAppUrl}/dashboard/templates/${layoutTemplateId}`,
        ...(hasRequired
          ? {}
          : {
              warning: `This layout has no "blog_${requiredMarker === "postList" ? "post_list" : requiredMarker}" element yet — until you add one, the public site falls back to the default blog theme instead of using this custom layout.`,
            }),
      };
    }

    case "reset_blog_layout": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      if (!isLayoutKind(args.kind)) throw new Error('kind must be "post" or "listing".');
      const kind = args.kind;

      const { data: siteRow } = await BlogSite.get({ templateId: siteId }).go();
      if (siteRow) {
        await BlogSite.patch({ templateId: siteId })
          .remove(kind === "post" ? ["postLayoutTemplateId"] : ["listingLayoutTemplateId"])
          .go();
      }

      return {
        success: true,
        kind,
        message: "Layout detached — the site now uses the default built-in blog theme. The layout template itself was not deleted; call design_blog_layout again to reattach or start a new one.",
      };
    }

    case "get_blog_settings": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const { data: site } = await BlogSite.get({ templateId: siteId }).go();
      return {
        site: site ?? {
          templateId: siteId,
          enabled: false,
          title: "Blog",
          description: null,
          postsPerPage: 10,
          showOnHomepage: false,
          accentColor: null,
          fontPreset: "sans",
          logoUrl: null,
          headerImageUrl: null,
          commentsEnabled: true,
        },
      };
    }

    case "update_blog_settings": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const data: Record<string, unknown> = {};
      type RemovableField = "description" | "accentColor" | "logoUrl" | "headerImageUrl";
      const toRemove: RemovableField[] = [];

      if (args.enabled !== undefined) data.enabled = Boolean(args.enabled);
      if (args.title !== undefined) {
        const title = String(args.title).trim();
        if (!title) throw new Error("Blog title can't be empty.");
        data.title = title;
      }
      if (args.description !== undefined) {
        const description = typeof args.description === "string" ? args.description.trim() : "";
        if (description) data.description = description;
        else toRemove.push("description");
      }
      if (args.postsPerPage !== undefined) {
        const n = Number(args.postsPerPage);
        if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error("postsPerPage must be an integer between 1 and 50.");
        data.postsPerPage = n;
      }
      if (args.showOnHomepage !== undefined) data.showOnHomepage = Boolean(args.showOnHomepage);
      if (args.accentColor !== undefined) {
        if (args.accentColor && !HEX_COLOR_REGEX.test(args.accentColor)) throw new Error("accentColor must be a hex value like #6d28d9.");
        if (args.accentColor) data.accentColor = args.accentColor;
        else toRemove.push("accentColor");
      }
      if (args.fontPreset !== undefined) {
        if (!VALID_FONT_PRESETS.has(args.fontPreset)) throw new Error(`fontPreset must be one of: ${[...VALID_FONT_PRESETS].join(", ")}.`);
        data.fontPreset = args.fontPreset;
      }
      if (args.logoUrl !== undefined) {
        if (args.logoUrl) data.logoUrl = args.logoUrl;
        else toRemove.push("logoUrl");
      }
      if (args.headerImageUrl !== undefined) {
        if (args.headerImageUrl) data.headerImageUrl = args.headerImageUrl;
        else toRemove.push("headerImageUrl");
      }
      if (args.commentsEnabled !== undefined) data.commentsEnabled = Boolean(args.commentsEnabled);

      if (Object.keys(data).length === 0 && toRemove.length === 0) {
        throw new Error("Provide at least one setting to update (enabled, title, description, postsPerPage, showOnHomepage, accentColor, fontPreset, logoUrl, headerImageUrl, commentsEnabled).");
      }

      const { data: existing } = await BlogSite.get({ templateId: siteId }).go();
      if (existing) {
        let patch = BlogSite.patch({ templateId: siteId }).set(data);
        if (toRemove.length) patch = patch.remove(toRemove);
        await patch.go();
      } else {
        await BlogSite.create({ id: randomUUID(), templateId: siteId, ...data }).go();
      }
      const { data: site } = await BlogSite.get({ templateId: siteId }).go();
      return { success: true, site };
    }

    case "list_blog_posts": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const [{ data: allPosts }, { data: categories }, { data: authors }] = await Promise.all([
        BlogPost.query.byStatus({ templateId: siteId }).go(),
        BlogCategory.query.primary({ templateId: siteId }).go(),
        BlogAuthor.query.primary({ templateId: siteId }).go(),
      ]);

      let filtered = allPosts;
      if (typeof args.status === "string" && BLOG_POST_STATUSES.has(args.status)) {
        filtered = filtered.filter((p) => p.status === args.status);
      }
      if (typeof args.search === "string" && args.search.trim()) {
        const needle = args.search.trim().toLowerCase();
        filtered = filtered.filter((p) => p.title.toLowerCase().includes(needle));
      }
      if (typeof args.categorySlug === "string" && args.categorySlug.trim()) {
        const category = categories.find((c) => c.slug === args.categorySlug.trim());
        const { data: linked } = category
          ? await BlogPostCategory.query.byCategory({ categoryId: category.id }).go()
          : { data: [] as { postId: string; templateId: string }[] };
        const postIdsInCategory = new Set(linked.filter((l) => l.templateId === siteId).map((l) => l.postId));
        filtered = filtered.filter((p) => postIdsInCategory.has(p.id));
      }

      filtered = [...filtered].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, 200);

      const categoryById = new Map(categories.map((c) => [c.id, c]));
      const authorById = new Map(authors.map((a) => [a.id, a]));
      const postCategoryBatches = await Promise.all(filtered.map((p) => BlogPostCategory.query.primary({ templateId: siteId, postId: p.id }).go()));

      return {
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
          author: p.authorId && authorById.has(p.authorId) ? { id: p.authorId, name: authorById.get(p.authorId)!.name } : null,
          categories: postCategoryBatches[i].data
            .map((pc) => categoryById.get(pc.categoryId))
            .filter((c): c is NonNullable<typeof c> => !!c)
            .map((c) => ({ category: { id: c.id, name: c.name, slug: c.slug } })),
          effectiveStatus: effectiveStatus(p.status ?? "DRAFT", p.publishedAt ?? null),
        })),
      };
    }

    case "get_blog_post": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const postId = typeof args.postId === "string" ? args.postId.trim() : "";
      const slugArg = typeof args.slug === "string" ? args.slug.trim() : "";
      if (!postId && !slugArg) throw new Error("postId or slug is required.");

      let post: { id: string; slug: string; [k: string]: unknown } | null = null;
      if (slugArg) {
        const { data } = await BlogPost.get({ templateId: siteId, slug: slugArg }).go();
        post = data;
      } else {
        const { data: allPosts } = await BlogPost.query.byStatus({ templateId: siteId }).go();
        post = allPosts.find((p) => p.id === postId) ?? null;
      }
      if (!post) throw new Error(`Post not found (${postId ? `id "${postId}"` : `slug "${slugArg}"`}).`);

      const [{ data: categories }, { data: tags }, { data: authors }, { data: postCategories }, { data: postTags }] = await Promise.all([
        BlogCategory.query.primary({ templateId: siteId }).go(),
        BlogTag.query.primary({ templateId: siteId }).go(),
        BlogAuthor.query.primary({ templateId: siteId }).go(),
        BlogPostCategory.query.primary({ templateId: siteId, postId: post.id }).go(),
        BlogPostTag.query.primary({ templateId: siteId, postId: post.id }).go(),
      ]);
      const categoryById = new Map(categories.map((c) => [c.id, c]));
      const tagById = new Map(tags.map((t) => [t.id, t]));
      const author = post.authorId ? authors.find((a) => a.id === post!.authorId) : undefined;

      return {
        post: {
          ...post,
          categories: postCategories.map((pc) => categoryById.get(pc.categoryId)).filter((c): c is NonNullable<typeof c> => !!c),
          tags: postTags.map((pt) => tagById.get(pt.tagId)).filter((t): t is NonNullable<typeof t> => !!t),
          author: author ? { id: author.id, name: author.name, slug: author.slug } : null,
          effectiveStatus: effectiveStatus((post.status as string) ?? "DRAFT", (post.publishedAt as string | null) ?? null),
        },
      };
    }

    case "create_blog_post": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const title = typeof args.title === "string" ? args.title.trim() : "";
      if (!title) throw new Error("title is required.");

      const contentHtml = typeof args.contentHtml === "string" ? args.contentHtml : "";
      const contentJson = convertWordPressHtmlToTiptapJson(contentHtml);

      const authorId = await resolveAuthorId(siteId, args.authorName);
      const categoryIds = await resolveCategoryIds(siteId, normalizeStringArray(args.categoryNames));
      const tagIds = await resolveTagIds(siteId, normalizeStringArray(args.tagNames));
      const status = typeof args.status === "string" && BLOG_POST_STATUSES.has(args.status) ? (args.status as "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED") : "DRAFT";

      const post = await createBlogPost(siteId, {
        title,
        slug: typeof args.slug === "string" ? args.slug : null,
        excerpt: typeof args.excerpt === "string" ? args.excerpt : null,
        contentJson,
        contentHtml,
        featuredImageUrl: typeof args.featuredImageUrl === "string" ? args.featuredImageUrl : null,
        featuredImageAlt: typeof args.featuredImageAlt === "string" ? args.featuredImageAlt : null,
        status,
        scheduledAt: typeof args.scheduledAt === "string" ? args.scheduledAt : null,
        metaTitle: typeof args.metaTitle === "string" ? args.metaTitle : null,
        metaDescription: typeof args.metaDescription === "string" ? args.metaDescription : null,
        ogImageUrl: typeof args.ogImageUrl === "string" ? args.ogImageUrl : null,
        noindex: Boolean(args.noindex),
        authorId: authorId ?? null,
        categoryIds: categoryIds ?? [],
        tagIds: tagIds ?? [],
      });

      return {
        success: true,
        postId: post.id,
        slug: post.slug,
        status: post.status,
        editableUrl: `${baseAppUrl}/dashboard/templates/${siteId}/blog/${post.id}`,
      };
    }

    case "update_blog_post": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const postId = typeof args.postId === "string" ? args.postId.trim() : "";
      if (!postId) throw new Error("postId is required.");

      const input: Record<string, unknown> = {};
      if (typeof args.title === "string") input.title = args.title;
      if (typeof args.slug === "string") input.slug = args.slug;
      if (typeof args.excerpt === "string") input.excerpt = args.excerpt;
      if (typeof args.contentHtml === "string") {
        input.contentHtml = args.contentHtml;
        input.contentJson = convertWordPressHtmlToTiptapJson(args.contentHtml);
      }
      if (typeof args.featuredImageUrl === "string" || args.featuredImageUrl === null) input.featuredImageUrl = args.featuredImageUrl;
      if (typeof args.featuredImageAlt === "string" || args.featuredImageAlt === null) input.featuredImageAlt = args.featuredImageAlt;
      if (typeof args.status === "string" && BLOG_POST_STATUSES.has(args.status)) input.status = args.status;
      if (typeof args.scheduledAt === "string" || args.scheduledAt === null) input.scheduledAt = args.scheduledAt;
      if (typeof args.metaTitle === "string" || args.metaTitle === null) input.metaTitle = args.metaTitle;
      if (typeof args.metaDescription === "string" || args.metaDescription === null) input.metaDescription = args.metaDescription;
      if (typeof args.ogImageUrl === "string" || args.ogImageUrl === null) input.ogImageUrl = args.ogImageUrl;
      if (args.noindex !== undefined) input.noindex = Boolean(args.noindex);
      if (args.authorName !== undefined) input.authorId = await resolveAuthorId(siteId, args.authorName);
      const categoryIds = await resolveCategoryIds(siteId, normalizeStringArray(args.categoryNames));
      if (categoryIds !== undefined) input.categoryIds = categoryIds;
      const tagIds = await resolveTagIds(siteId, normalizeStringArray(args.tagNames));
      if (tagIds !== undefined) input.tagIds = tagIds;

      const post = await updateBlogPost(siteId, postId, input as any);
      if (!post) throw new Error(`Post not found with id "${postId}".`);

      return { success: true, postId: post.id, slug: post.slug, status: post.status };
    }

    case "delete_blog_post": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const postId = typeof args.postId === "string" ? args.postId.trim() : "";
      if (!postId) throw new Error("postId is required.");

      const deleted = await deleteBlogPost(siteId, postId);
      if (!deleted) throw new Error(`Post not found with id "${postId}".`);

      return { success: true, deletedPostId: postId };
    }

    case "list_blog_categories": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const { data: categories } = await BlogCategory.query.primary({ templateId: siteId }).go();
      categories.sort((a, b) => a.name.localeCompare(b.name));
      return { categories };
    }

    case "create_blog_category": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new Error("name is required.");

      const { data: siblings } = await BlogCategory.query.primary({ templateId: siteId }).go();

      let parentId: string | undefined;
      if (typeof args.parentName === "string" && args.parentName.trim()) {
        const parent = siblings.find((c) => c.name.toLowerCase() === args.parentName.trim().toLowerCase());
        if (!parent) throw new Error(`Parent category "${args.parentName}" not found.`);
        parentId = parent.id;
      }

      const baseSlug = avoidPageReservedSlug(slugify(name) || "category", "category");
      let slug = baseSlug;
      let suffix = 2;
      while ((await BlogCategory.get({ templateId: siteId, slug }).go()).data) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const id = randomUUID();
      await BlogCategory.create({
        id,
        templateId: siteId,
        name,
        slug,
        description: (typeof args.description === "string" && args.description.trim()) || undefined,
        parentId,
      }).go();
      const { data: category } = await BlogCategory.get({ templateId: siteId, slug }).go();
      return { success: true, category };
    }

    case "delete_blog_category": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const idOrName = (typeof args.categoryId === "string" && args.categoryId.trim()) || (typeof args.name === "string" && args.name.trim()) || "";
      if (!idOrName) throw new Error("categoryId or name is required.");

      const { data: categories } = await BlogCategory.query.primary({ templateId: siteId }).go();
      let category = isValidUuid(idOrName) ? categories.find((c) => c.id === idOrName) : undefined;
      if (!category) category = categories.find((c) => c.name.toLowerCase() === idOrName.toLowerCase());
      if (!category) throw new Error(`Category "${idOrName}" not found.`);

      // Postgres's onDelete: Cascade on BlogPostCategory -> BlogCategory has no DynamoDB
      // equivalent — clean up the join rows explicitly via byCategory (GSI1) first.
      const { data: links } = await BlogPostCategory.query.byCategory({ categoryId: category.id }).go();
      await Promise.all(links.map((l) => BlogPostCategory.remove({ templateId: l.templateId, postId: l.postId, categoryId: l.categoryId }).go()));

      await BlogCategory.remove({ templateId: siteId, slug: category.slug }).go();
      return { success: true, deletedCategoryId: category.id };
    }

    case "list_blog_tags": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const { data: tags } = await BlogTag.query.primary({ templateId: siteId }).go();
      tags.sort((a, b) => a.name.localeCompare(b.name));
      return { tags };
    }

    case "create_blog_tag": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new Error("name is required.");

      const baseSlug = avoidPageReservedSlug(slugify(name) || "tag", "tag");
      let slug = baseSlug;
      let suffix = 2;
      while ((await BlogTag.get({ templateId: siteId, slug }).go()).data) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const id = randomUUID();
      await BlogTag.create({ id, templateId: siteId, name, slug }).go();
      const { data: tag } = await BlogTag.get({ templateId: siteId, slug }).go();
      return { success: true, tag };
    }

    case "delete_blog_tag": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const idOrName = (typeof args.tagId === "string" && args.tagId.trim()) || (typeof args.name === "string" && args.name.trim()) || "";
      if (!idOrName) throw new Error("tagId or name is required.");

      const { data: tags } = await BlogTag.query.primary({ templateId: siteId }).go();
      let tag = isValidUuid(idOrName) ? tags.find((t) => t.id === idOrName) : undefined;
      if (!tag) tag = tags.find((t) => t.name.toLowerCase() === idOrName.toLowerCase());
      if (!tag) throw new Error(`Tag "${idOrName}" not found.`);

      // Postgres's onDelete: Cascade on BlogPostTag -> BlogTag has no DynamoDB
      // equivalent — clean up the join rows explicitly via byTag (GSI1) first.
      const { data: links } = await BlogPostTag.query.byTag({ tagId: tag.id }).go();
      await Promise.all(links.map((l) => BlogPostTag.remove({ templateId: l.templateId, postId: l.postId, tagId: l.tagId }).go()));

      await BlogTag.remove({ templateId: siteId, slug: tag.slug }).go();
      return { success: true, deletedTagId: tag.id };
    }

    case "list_blog_authors": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const { data: authors } = await BlogAuthor.query.primary({ templateId: siteId }).go();
      authors.sort((a, b) => a.name.localeCompare(b.name));
      return { authors };
    }

    case "create_blog_author": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new Error("name is required.");

      const slug = await generateUniqueAuthorSlug(siteId, name);
      const id = randomUUID();
      await BlogAuthor.create({
        id,
        templateId: siteId,
        name,
        slug,
        avatarUrl: (typeof args.avatarUrl === "string" && args.avatarUrl.trim()) || undefined,
        bio: (typeof args.bio === "string" && args.bio.trim()) || undefined,
      }).go();
      const { data: author } = await BlogAuthor.get({ templateId: siteId, slug }).go();
      return { success: true, author };
    }

    case "delete_blog_author": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const idOrName = (typeof args.authorId === "string" && args.authorId.trim()) || (typeof args.name === "string" && args.name.trim()) || "";
      if (!idOrName) throw new Error("authorId or name is required.");

      const { data: authors } = await BlogAuthor.query.primary({ templateId: siteId }).go();
      let author = isValidUuid(idOrName) ? authors.find((a) => a.id === idOrName) : undefined;
      if (!author) author = authors.find((a) => a.name.toLowerCase() === idOrName.toLowerCase());
      if (!author) throw new Error(`Author "${idOrName}" not found.`);

      // Posts keep their content — they just lose the byline (Prisma: onDelete: SetNull).
      // No DynamoDB equivalent, so every post referencing this author is patched first.
      const { data: posts } = await BlogPost.query.byStatus({ templateId: siteId }).go();
      const affected = posts.filter((p) => p.authorId === author!.id);
      await Promise.all(affected.map((p) => BlogPost.patch({ templateId: siteId, slug: p.slug }).remove(["authorId"]).go()));

      await BlogAuthor.remove({ templateId: siteId, slug: author.slug }).go();
      return { success: true, deletedAuthorId: author.id };
    }

    case "list_blog_comments": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const statusFilter = typeof args.status === "string" && BLOG_COMMENT_STATUSES.has(args.status) ? args.status : undefined;

      // BlogComment is scoped by postId, not templateId (see contentEntities.ts) — no
      // direct "every comment on this site" index, so this fans out per post.
      const { data: posts } = await BlogPost.query.byStatus({ templateId: siteId }).go();
      const postById = new Map(posts.map((p) => [p.id, p]));
      const commentBatches = await Promise.all(posts.map((p) => BlogComment.query.primary({ postId: p.id }).go()));
      let comments = commentBatches.flatMap((b) => b.data);
      if (statusFilter) comments = comments.filter((c) => c.status === statusFilter);
      comments = comments.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 200);

      return {
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
      };
    }

    case "moderate_blog_comment": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const commentId = typeof args.commentId === "string" ? args.commentId.trim() : "";
      if (!commentId) throw new Error("commentId is required.");
      if (typeof args.status !== "string" || !BLOG_COMMENT_STATUSES.has(args.status)) {
        throw new Error(`status must be one of: ${[...BLOG_COMMENT_STATUSES].join(", ")}.`);
      }
      const newStatus = args.status as "PENDING" | "APPROVED" | "SPAM" | "REJECTED";

      const comment = await findCommentById(siteId, commentId);
      if (!comment) throw new Error(`Comment not found with id "${commentId}".`);

      // status is part of this entity's own sort key (see contentEntities.ts) — same
      // create-at-new-key + remove-old-key pattern savePostDynamo.ts uses for a slug rename.
      await BlogComment.create({ ...comment, status: newStatus }).go();
      await BlogComment.remove({ postId: comment.postId, status: comment.status ?? "PENDING", createdAt: comment.createdAt ?? "", id: comment.id }).go();
      const { data: updated } = await BlogComment.get({ postId: comment.postId, status: newStatus, createdAt: comment.createdAt ?? "", id: comment.id }).go();

      return { success: true, comment: updated };
    }

    case "delete_blog_comment": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const commentId = typeof args.commentId === "string" ? args.commentId.trim() : "";
      if (!commentId) throw new Error("commentId is required.");

      const comment = await findCommentById(siteId, commentId);
      if (!comment) throw new Error(`Comment not found with id "${commentId}".`);

      // Cascade (Prisma schema's onDelete: Cascade on parentId) also removes any replies
      // to this comment — walked explicitly since DynamoDB has no equivalent.
      const replies = await getDescendantCommentIds(comment.postId, commentId);
      await Promise.all(
        [...replies, comment].map((c) =>
          BlogComment.remove({ postId: c.postId, status: c.status ?? "PENDING", createdAt: c.createdAt ?? "", id: c.id }).go(),
        ),
      );
      return { success: true, deletedCommentId: commentId };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
