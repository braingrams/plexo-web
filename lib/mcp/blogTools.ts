import { BlogPostStatus, BlogCommentStatus, TemplateKind } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { compileToHTML } from "@/lib/compiler";
import { TemplateJSONSchema, hydrateStructuralDefaults, formatValidationIssues, sanitizeHtml } from "@/server/sanitizer";
import { resolveUser } from "@/app/api/v1/domains/route";
import { createBlogPost, updateBlogPost, deleteBlogPost } from "@/lib/blog/savePost";
import { generateUniqueAuthorSlug } from "@/lib/blog/authors";
import { effectiveStatus } from "@/lib/blog/queries";
import { slugify, avoidPageReservedSlug, isValidUuid } from "@/server/slug";
import { convertWordPressHtmlToTiptapJson } from "@/lib/blogImport/htmlToTiptap";
import { FONT_PRESET_OPTIONS } from "@/lib/pub/blogTheme";
import { hasBlogMarker, type BlogMarkerName } from "@/lib/pub/blogLayoutRender";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

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
  const site = await prisma.template.findFirst({
    where: { id: trimmed, organizationId: resolved.organizationId, parentId: null },
    select: { id: true },
  });
  if (!site) {
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
  const existing = await prisma.blogAuthor.findFirst({ where: { templateId, name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing.id;
  const slug = await generateUniqueAuthorSlug(templateId, name);
  const created = await prisma.blogAuthor.create({ data: { templateId, name, slug } });
  return created.id;
}

async function resolveCategoryIds(templateId: string, names: string[] | undefined): Promise<string[] | undefined> {
  if (names === undefined) return undefined;
  const ids: string[] = [];
  for (const name of names) {
    const existing = await prisma.blogCategory.findFirst({ where: { templateId, name: { equals: name, mode: "insensitive" } } });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const baseSlug = avoidPageReservedSlug(slugify(name) || "category", "category");
    let slug = baseSlug;
    let suffix = 2;
    while (await prisma.blogCategory.findFirst({ where: { templateId, slug }, select: { id: true } })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const created = await prisma.blogCategory.create({ data: { templateId, name, slug } });
    ids.push(created.id);
  }
  return ids;
}

async function resolveTagIds(templateId: string, names: string[] | undefined): Promise<string[] | undefined> {
  if (names === undefined) return undefined;
  const ids: string[] = [];
  for (const name of names) {
    const existing = await prisma.blogTag.findFirst({ where: { templateId, name: { equals: name, mode: "insensitive" } } });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const baseSlug = avoidPageReservedSlug(slugify(name) || "tag", "tag");
    let slug = baseSlug;
    let suffix = 2;
    while (await prisma.blogTag.findFirst({ where: { templateId, slug }, select: { id: true } })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const created = await prisma.blogTag.create({ data: { templateId, name, slug } });
    ids.push(created.id);
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
  const site = await prisma.blogSite.findUnique({ where: { templateId: siteId } });
  const existingId = kind === "post" ? site?.postLayoutTemplateId : site?.listingLayoutTemplateId;
  if (existingId) return existingId;

  const layoutTemplate = await prisma.template.create({
    data: {
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      name: kind === "post" ? "Blog Post Layout" : "Blog Listing Layout",
      kind: TemplateKind.LANDING_PAGE,
      isBlogLayout: true,
      designJson: { body: { style: { background: "#ffffff", padding: "24px" }, rows: [] } },
      compiledHtml: "",
    },
    select: { id: true },
  });

  await prisma.blogSite.upsert({
    where: { templateId: siteId },
    create: {
      templateId: siteId,
      ...(kind === "post" ? { postLayoutTemplateId: layoutTemplate.id } : { listingLayoutTemplateId: layoutTemplate.id }),
    },
    update: kind === "post" ? { postLayoutTemplateId: layoutTemplate.id } : { listingLayoutTemplateId: layoutTemplate.id },
  });

  return layoutTemplate.id;
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

      const site = await prisma.blogSite.findUnique({ where: { templateId: siteId } });
      const layoutTemplateId = kind === "post" ? site?.postLayoutTemplateId : site?.listingLayoutTemplateId;
      if (!layoutTemplateId) {
        return {
          exists: false,
          kind,
          message: "No custom layout designed yet for this kind — call design_blog_layout to create one (the site uses the default built-in theme until then).",
        };
      }

      const layout = await prisma.template.findUnique({
        where: { id: layoutTemplateId },
        select: { id: true, name: true, designJson: true, compiledHtml: true },
      });
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
      const updated = await prisma.template.update({
        where: { id: layoutTemplateId },
        data: { designJson, compiledHtml, ...(name ? { name } : {}) },
      });

      return {
        success: true,
        layoutTemplateId: updated.id,
        kind,
        editableUrl: `${baseAppUrl}/dashboard/templates/${updated.id}`,
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

      await prisma.blogSite.updateMany({
        where: { templateId: siteId },
        data: kind === "post" ? { postLayoutTemplateId: null } : { listingLayoutTemplateId: null },
      });

      return {
        success: true,
        kind,
        message: "Layout detached — the site now uses the default built-in blog theme. The layout template itself was not deleted; call design_blog_layout again to reattach or start a new one.",
      };
    }

    case "get_blog_settings": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const site = await prisma.blogSite.findUnique({ where: { templateId: siteId } });
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

      if (args.enabled !== undefined) data.enabled = Boolean(args.enabled);
      if (args.title !== undefined) {
        const title = String(args.title).trim();
        if (!title) throw new Error("Blog title can't be empty.");
        data.title = title;
      }
      if (args.description !== undefined) data.description = (typeof args.description === "string" && args.description.trim()) || null;
      if (args.postsPerPage !== undefined) {
        const n = Number(args.postsPerPage);
        if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error("postsPerPage must be an integer between 1 and 50.");
        data.postsPerPage = n;
      }
      if (args.showOnHomepage !== undefined) data.showOnHomepage = Boolean(args.showOnHomepage);
      if (args.accentColor !== undefined) {
        if (args.accentColor && !HEX_COLOR_REGEX.test(args.accentColor)) throw new Error("accentColor must be a hex value like #6d28d9.");
        data.accentColor = args.accentColor || null;
      }
      if (args.fontPreset !== undefined) {
        if (!VALID_FONT_PRESETS.has(args.fontPreset)) throw new Error(`fontPreset must be one of: ${[...VALID_FONT_PRESETS].join(", ")}.`);
        data.fontPreset = args.fontPreset;
      }
      if (args.logoUrl !== undefined) data.logoUrl = args.logoUrl || null;
      if (args.headerImageUrl !== undefined) data.headerImageUrl = args.headerImageUrl || null;
      if (args.commentsEnabled !== undefined) data.commentsEnabled = Boolean(args.commentsEnabled);

      if (Object.keys(data).length === 0) {
        throw new Error("Provide at least one setting to update (enabled, title, description, postsPerPage, showOnHomepage, accentColor, fontPreset, logoUrl, headerImageUrl, commentsEnabled).");
      }

      const site = await prisma.blogSite.upsert({ where: { templateId: siteId }, create: { templateId: siteId, ...data }, update: data });
      return { success: true, site };
    }

    case "list_blog_posts": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const where: any = { templateId: siteId };
      if (typeof args.status === "string" && args.status in BlogPostStatus) where.status = args.status;
      if (typeof args.search === "string" && args.search.trim()) where.title = { contains: args.search.trim(), mode: "insensitive" };
      if (typeof args.categorySlug === "string" && args.categorySlug.trim()) {
        const category = await prisma.blogCategory.findFirst({ where: { templateId: siteId, slug: args.categorySlug.trim() }, select: { id: true } });
        where.categories = { some: { categoryId: category?.id ?? "__no_match__" } };
      }

      const posts = await prisma.blogPost.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: {
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
        },
      });

      return { posts: posts.map((p) => ({ ...p, effectiveStatus: effectiveStatus(p.status, p.publishedAt) })) };
    }

    case "get_blog_post": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const postId = typeof args.postId === "string" ? args.postId.trim() : "";
      const slug = typeof args.slug === "string" ? args.slug.trim() : "";
      if (!postId && !slug) throw new Error("postId or slug is required.");

      const post = await prisma.blogPost.findFirst({
        where: { templateId: siteId, ...(postId ? { id: postId } : { slug }) },
        include: {
          categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
          tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
          author: { select: { id: true, name: true, slug: true } },
        },
      });
      if (!post) throw new Error(`Post not found (${postId ? `id "${postId}"` : `slug "${slug}"`}).`);

      return { post: { ...post, effectiveStatus: effectiveStatus(post.status, post.publishedAt) } };
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
      const status = typeof args.status === "string" && args.status in BlogPostStatus ? (args.status as BlogPostStatus) : BlogPostStatus.DRAFT;

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
      if (typeof args.status === "string" && args.status in BlogPostStatus) input.status = args.status;
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
      const categories = await prisma.blogCategory.findMany({ where: { templateId: siteId }, orderBy: { name: "asc" } });
      return { categories };
    }

    case "create_blog_category": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new Error("name is required.");

      let parentId: string | null = null;
      if (typeof args.parentName === "string" && args.parentName.trim()) {
        const parent = await prisma.blogCategory.findFirst({ where: { templateId: siteId, name: { equals: args.parentName.trim(), mode: "insensitive" } } });
        if (!parent) throw new Error(`Parent category "${args.parentName}" not found.`);
        parentId = parent.id;
      }

      const baseSlug = avoidPageReservedSlug(slugify(name) || "category", "category");
      let slug = baseSlug;
      let suffix = 2;
      while (await prisma.blogCategory.findFirst({ where: { templateId: siteId, slug }, select: { id: true } })) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const category = await prisma.blogCategory.create({
        data: { templateId: siteId, name, slug, description: typeof args.description === "string" ? args.description.trim() || null : null, parentId },
      });
      return { success: true, category };
    }

    case "delete_blog_category": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const idOrName = (typeof args.categoryId === "string" && args.categoryId.trim()) || (typeof args.name === "string" && args.name.trim()) || "";
      if (!idOrName) throw new Error("categoryId or name is required.");

      let category = isValidUuid(idOrName) ? await prisma.blogCategory.findFirst({ where: { id: idOrName, templateId: siteId } }) : null;
      if (!category) category = await prisma.blogCategory.findFirst({ where: { templateId: siteId, name: { equals: idOrName, mode: "insensitive" } } });
      if (!category) throw new Error(`Category "${idOrName}" not found.`);

      await prisma.blogCategory.delete({ where: { id: category.id } });
      return { success: true, deletedCategoryId: category.id };
    }

    case "list_blog_tags": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const tags = await prisma.blogTag.findMany({ where: { templateId: siteId }, orderBy: { name: "asc" } });
      return { tags };
    }

    case "create_blog_tag": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new Error("name is required.");

      const baseSlug = avoidPageReservedSlug(slugify(name) || "tag", "tag");
      let slug = baseSlug;
      let suffix = 2;
      while (await prisma.blogTag.findFirst({ where: { templateId: siteId, slug }, select: { id: true } })) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const tag = await prisma.blogTag.create({ data: { templateId: siteId, name, slug } });
      return { success: true, tag };
    }

    case "delete_blog_tag": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const idOrName = (typeof args.tagId === "string" && args.tagId.trim()) || (typeof args.name === "string" && args.name.trim()) || "";
      if (!idOrName) throw new Error("tagId or name is required.");

      let tag = isValidUuid(idOrName) ? await prisma.blogTag.findFirst({ where: { id: idOrName, templateId: siteId } }) : null;
      if (!tag) tag = await prisma.blogTag.findFirst({ where: { templateId: siteId, name: { equals: idOrName, mode: "insensitive" } } });
      if (!tag) throw new Error(`Tag "${idOrName}" not found.`);

      await prisma.blogTag.delete({ where: { id: tag.id } });
      return { success: true, deletedTagId: tag.id };
    }

    case "list_blog_authors": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const authors = await prisma.blogAuthor.findMany({ where: { templateId: siteId }, orderBy: { name: "asc" } });
      return { authors };
    }

    case "create_blog_author": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new Error("name is required.");

      const slug = await generateUniqueAuthorSlug(siteId, name);
      const author = await prisma.blogAuthor.create({
        data: {
          templateId: siteId,
          name,
          slug,
          avatarUrl: typeof args.avatarUrl === "string" ? args.avatarUrl.trim() || null : null,
          bio: typeof args.bio === "string" ? args.bio.trim() || null : null,
        },
      });
      return { success: true, author };
    }

    case "delete_blog_author": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const idOrName = (typeof args.authorId === "string" && args.authorId.trim()) || (typeof args.name === "string" && args.name.trim()) || "";
      if (!idOrName) throw new Error("authorId or name is required.");

      let author = isValidUuid(idOrName) ? await prisma.blogAuthor.findFirst({ where: { id: idOrName, templateId: siteId } }) : null;
      if (!author) author = await prisma.blogAuthor.findFirst({ where: { templateId: siteId, name: { equals: idOrName, mode: "insensitive" } } });
      if (!author) throw new Error(`Author "${idOrName}" not found.`);

      await prisma.blogAuthor.delete({ where: { id: author.id } });
      return { success: true, deletedAuthorId: author.id };
    }

    case "list_blog_comments": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const statusFilter = typeof args.status === "string" && args.status in BlogCommentStatus ? (args.status as BlogCommentStatus) : undefined;

      const comments = await prisma.blogComment.findMany({
        where: { post: { templateId: siteId }, ...(statusFilter ? { status: statusFilter } : {}) },
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
      return { comments };
    }

    case "moderate_blog_comment": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const commentId = typeof args.commentId === "string" ? args.commentId.trim() : "";
      if (!commentId) throw new Error("commentId is required.");
      if (typeof args.status !== "string" || !(args.status in BlogCommentStatus)) {
        throw new Error(`status must be one of: ${Object.values(BlogCommentStatus).join(", ")}.`);
      }

      const comment = await prisma.blogComment.findFirst({ where: { id: commentId, post: { templateId: siteId } }, select: { id: true } });
      if (!comment) throw new Error(`Comment not found with id "${commentId}".`);

      const updated = await prisma.blogComment.update({ where: { id: commentId }, data: { status: args.status as BlogCommentStatus } });
      return { success: true, comment: updated };
    }

    case "delete_blog_comment": {
      const siteId = await resolveBlogSiteId(resolved, args.templateId);
      const commentId = typeof args.commentId === "string" ? args.commentId.trim() : "";
      if (!commentId) throw new Error("commentId is required.");

      const comment = await prisma.blogComment.findFirst({ where: { id: commentId, post: { templateId: siteId } }, select: { id: true } });
      if (!comment) throw new Error(`Comment not found with id "${commentId}".`);

      await prisma.blogComment.delete({ where: { id: commentId } });
      return { success: true, deletedCommentId: commentId };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
