import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-content. Field shapes ported 1:1 from schema.prisma. Most entities scope by
// templateId (co-located, matches how they're actually queried — "everything for this
// site"); a few genuinely platform-wide entities (Testimonial, TemplateGenerationJob)
// get their own top-level key instead. GSI1/GSI2 picked per-entity for the real access
// pattern, unique constraints moved into the primary SK wherever DynamoDB's own
// uniqueness (not GSIs) can enforce them for free, same discipline as commerce/ledger.

const table = TABLES.content;

export const Template = new Entity(
  {
    model: { entity: "template", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      name: { type: "string", required: true },
      kind: { type: ["EMAIL", "LANDING_PAGE"] as const, required: true },
      sourceType: { type: ["BUILDER", "RAW_UPLOAD"] as const, default: "BUILDER" },
      designJson: { type: "any", required: true },
      compiledHtml: { type: "string", required: true },
      sdkVersion: { type: "string" },
      compiledAt: { type: "string" },
      parentId: { type: "string" },
      slug: { type: "string" },
      order: { type: "number", default: 0 },
      isOfficial: { type: "boolean", default: false },
      marketplaceStatus: { type: ["DRAFT", "PENDING_REVIEW", "PUBLISHED", "REJECTED"] as const },
      marketplaceCategory: { type: "string" },
      marketplaceDescription: { type: "string" },
      priceCents: { type: "number" },
      marketplacePublishedAt: { type: "string" },
      marketplaceRejectionReason: { type: "string" },
      isBlogLayout: { type: "boolean", default: false },
      isSiteLayoutFragment: { type: "boolean", default: false },
      isCommerceLayout: { type: "boolean", default: false },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["id"], template: "TEMPLATE#${id}" },
        sk: { field: "sk", composite: [], template: "TEMPLATE" },
      },
      // The core dashboard need: "my org's templates," newest first.
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["updatedAt", "id"], template: "TEMPLATE#${updatedAt}#${id}" },
      },
      // Multipage: list a page's children in order (prisma: @@index([parentId]), `order`
      // field). Sparse for root templates (parentId null) — they simply don't appear
      // here, which is correct: "list children of no page" isn't a real query.
      byParent: {
        index: "GSI2",
        pk: { field: "GSI2PK", composite: ["parentId"], template: "PARENT#${parentId}" },
        sk: { field: "GSI2SK", composite: ["order", "id"], template: "TEMPLATE#${order}#${id}" },
      },
    },
  },
  { table, client: docClient },
);
// Known gap, not solved here: marketplace browsing (list by marketplaceStatus,
// platform-wide) has no dedicated index — Template already spent both its GSI slots on
// the two core authenticated-dashboard patterns (org list, page tree), which carry more
// load than the public marketplace browse page. Candidate for the Athena/export path or
// a future GSI3 if real traffic proves it needs one.

export const TemplateRevision = new Entity(
  {
    model: { entity: "templateRevision", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      designJson: { type: "any", required: true },
      compiledHtml: { type: "string", required: true },
      sdkVersion: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // Co-located with the template itself — "get this page + its revision history."
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "REVISION#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const TemplateAsset = new Entity(
  {
    model: { entity: "templateAsset", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      path: { type: "string", required: true },
      blobUrl: { type: "string", required: true },
      contentType: { type: "string", required: true },
      size: { type: "number", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // path as the SK enforces @@unique([templateId, path]) for free.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["path"], template: "ASSET#${path}" },
      },
    },
  },
  { table, client: docClient },
);

export const TemplatePurchase = new Entity(
  {
    model: { entity: "templatePurchase", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      templateId: { type: "string", required: true },
      priceCentsPaid: { type: "number", required: true },
      stripeSessionId: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // templateId as SK enforces @@unique([userId, templateId]) for free.
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: ["templateId"], template: "PURCHASE#${templateId}" },
      },
      // The seller-side need: "who bought this template" (prisma: @@index([templateId])).
      byTemplate: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "GSI1SK", composite: ["userId"], template: "PURCHASE#${userId}" },
      },
    },
  },
  { table, client: docClient },
);

export const PublishedDomain = new Entity(
  {
    model: { entity: "publishedDomain", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      templateId: { type: "string", required: true },
      domain: { type: "string", required: true },
      type: { type: ["SUBDOMAIN", "CUSTOM"] as const, required: true },
      dnsVerified: { type: "boolean", default: false },
      dnsVerifiedAt: { type: "string" },
      active: { type: "boolean", default: true },
      suspendedAt: { type: "string" },
      suspendedReason: { type: "string" },
      flagged: { type: "boolean", default: false },
      flagReason: { type: "string" },
      lastScannedAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "DOMAIN#${id}" },
      },
      // THE hot-path lookup: middleware.ts resolves every incoming tenant request by
      // hostname (prisma: domain @unique) — this is the busiest query this entity has.
      byDomain: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["domain"], template: "DOMAIN#${domain}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "DOMAIN#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogSite = new Entity(
  {
    model: { entity: "blogSite", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      enabled: { type: "boolean", default: false },
      title: { type: "string", default: "Blog" },
      description: { type: "string" },
      postsPerPage: { type: "number", default: 10 },
      defaultCategoryId: { type: "string" },
      showOnHomepage: { type: "boolean", default: false },
      accentColor: { type: "string" },
      fontPreset: { type: "string", default: "sans" },
      logoUrl: { type: "string" },
      headerImageUrl: { type: "string" },
      postLayoutTemplateId: { type: "string" },
      listingLayoutTemplateId: { type: "string" },
      commentsEnabled: { type: "boolean", default: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // One per template (prisma: templateId @unique) — co-located with the site.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: [], template: "BLOGSITE" },
      },
    },
  },
  { table, client: docClient },
);

export const SiteLayout = new Entity(
  {
    model: { entity: "siteLayout", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      enabled: { type: "boolean", default: false },
      headerTemplateId: { type: "string" },
      footerTemplateId: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: [], template: "SITELAYOUT" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogAuthor = new Entity(
  {
    model: { entity: "blogAuthor", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      userId: { type: "string" },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      avatarUrl: { type: "string" },
      bio: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // slug as SK enforces @@unique([templateId, slug]) for free.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["slug"], template: "AUTHOR#${slug}" },
      },
      byUser: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "GSI1SK", composite: ["templateId"], template: "AUTHOR#${templateId}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogCategory = new Entity(
  {
    model: { entity: "blogCategory", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      description: { type: "string" },
      parentId: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["slug"], template: "CATEGORY#${slug}" },
      },
      byParent: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["parentId"], template: "CATPARENT#${parentId}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "CATEGORY#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogTag = new Entity(
  {
    model: { entity: "blogTag", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["slug"], template: "TAG#${slug}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogPost = new Entity(
  {
    model: { entity: "blogPost", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      authorId: { type: "string" },
      title: { type: "string", required: true },
      slug: { type: "string", required: true },
      excerpt: { type: "string" },
      contentJson: { type: "any", required: true },
      contentHtml: { type: "string", required: true },
      featuredImageUrl: { type: "string" },
      featuredImageAlt: { type: "string" },
      status: { type: ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const, default: "DRAFT" },
      publishedAt: { type: "string" },
      scheduledAt: { type: "string" },
      metaTitle: { type: "string" },
      metaDescription: { type: "string" },
      ogImageUrl: { type: "string" },
      noindex: { type: "boolean", default: false },
      readingTimeMinutes: { type: "number" },
      viewCount: { type: "number", default: 0 },
      externalId: { type: "string" },
      commentsEnabled: { type: "boolean", default: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // slug as SK enforces @@unique([templateId, slug]) for free.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["slug"], template: "POST#${slug}" },
      },
      // The real blog-listing need: this site's posts, filterable by status, sorted by
      // publish date (prisma: @@index([templateId, status, publishedAt])).
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["templateId"], template: "TEMPLATEPOSTS#${templateId}" },
        sk: { field: "GSI1SK", composite: ["status", "publishedAt", "id"], template: "${status}#${publishedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);
// Known gap: @@unique([templateId, externalId]) — WordPress-import dedup — has no index
// here (SK is slug-keyed). Import-batch resumability needs this; deferred to whenever
// the WordPress importer itself gets ported, not fabricated as a guess now.

export const BlogPostCategory = new Entity(
  {
    model: { entity: "blogPostCategory", version: "1", service: "plexoContent" },
    attributes: {
      templateId: { type: "string", required: true }, // denormalized — not in Prisma, added for co-location
      postId: { type: "string", required: true },
      categoryId: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["postId", "categoryId"], template: "POSTCAT#${postId}#${categoryId}" },
      },
      byCategory: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["categoryId"], template: "CATEGORY#${categoryId}" },
        sk: { field: "GSI1SK", composite: ["postId"], template: "POST#${postId}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogPostTag = new Entity(
  {
    model: { entity: "blogPostTag", version: "1", service: "plexoContent" },
    attributes: {
      templateId: { type: "string", required: true }, // denormalized — not in Prisma, added for co-location
      postId: { type: "string", required: true },
      tagId: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["postId", "tagId"], template: "POSTTAG#${postId}#${tagId}" },
      },
      byTag: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["tagId"], template: "TAG#${tagId}" },
        sk: { field: "GSI1SK", composite: ["postId"], template: "POST#${postId}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogComment = new Entity(
  {
    model: { entity: "blogComment", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      postId: { type: "string", required: true },
      parentId: { type: "string" },
      authorName: { type: "string", required: true },
      authorEmail: { type: "string", required: true },
      body: { type: "string", required: true },
      status: { type: ["PENDING", "APPROVED", "SPAM", "REJECTED"] as const, default: "PENDING" },
      ipHash: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // Scoped by postId, not templateId — the real access pattern is "this post's
      // comment moderation queue," not a site-wide view (prisma: @@index([postId, status])).
      // status prefixed in the SK so a begins_with query filters the moderation queue
      // without a separate GSI.
      primary: {
        pk: { field: "pk", composite: ["postId"], template: "POST#${postId}" },
        sk: { field: "sk", composite: ["status", "createdAt", "id"], template: "COMMENT#${status}#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);
// Rate-limiting by ipHash (prisma: @@index([ipHash, createdAt])) deliberately doesn't
// get a GSI here — that's exactly what plexo-ops's RateLimit table already exists for,
// a better architectural fit than duplicating rate-limit state into plexo-content.

export const BlogRedirect = new Entity(
  {
    model: { entity: "blogRedirect", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      fromPath: { type: "string", required: true },
      toPath: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // fromPath as SK enforces @@unique([templateId, fromPath]) for free.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["fromPath"], template: "REDIRECT#${fromPath}" },
      },
    },
  },
  { table, client: docClient },
);

export const Testimonial = new Entity(
  {
    model: { entity: "testimonial", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      quote: { type: "string", required: true },
      name: { type: "string", required: true },
      role: { type: "string", required: true },
      company: { type: "string" },
      avatarUrl: { type: "string" },
      rating: { type: "number", default: 5 },
      status: { type: ["PENDING", "APPROVED", "REJECTED"] as const, default: "PENDING" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // Platform-wide, not site-scoped — no templateId field in the Prisma model at all.
      primary: {
        pk: { field: "pk", composite: ["id"], template: "TESTIMONIAL#${id}" },
        sk: { field: "sk", composite: [], template: "TESTIMONIAL" },
      },
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "TESTIMONIALSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "TESTIMONIAL#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const TemplateGenerationJob = new Entity(
  {
    model: { entity: "templateGenerationJob", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      status: { type: ["PENDING", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"] as const, default: "PENDING" },
      kind: { type: ["EMAIL", "LANDING_PAGE"] as const, required: true },
      isOptIn: { type: "boolean", default: false },
      category: { type: "string", required: true },
      priceCents: { type: "number", default: 0 },
      targetStatus: { type: ["DRAFT", "PENDING_REVIEW", "PUBLISHED", "REJECTED"] as const, required: true },
      provider: { type: "string", required: true },
      requestedCount: { type: "number", required: true },
      succeededCount: { type: "number", default: 0 },
      failedCount: { type: "number", default: 0 },
      createdTemplateIds: { type: "list", items: { type: "string" }, default: () => [] },
      errors: { type: "any" },
      lockedAt: { type: "string" },
      createdBy: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // Platform-wide admin batch jobs — not site-scoped.
      primary: {
        pk: { field: "pk", composite: ["id"], template: "GENJOB#${id}" },
        sk: { field: "sk", composite: [], template: "GENJOB" },
      },
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "GENJOBSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "GENJOB#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Not in any original phase's scope — found while walking plexo-admin's actual routes
// against what exists. Both were referenced by real admin dashboard pages
// (script-access-requests, feedback) with no entity anywhere to back them.
export const ScriptAccessRequest = new Entity(
  {
    model: { entity: "scriptAccessRequest", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      userId: { type: "string", required: true },
      reason: { type: "string" },
      status: { type: ["PENDING", "APPROVED", "REJECTED"] as const, default: "PENDING" },
      requestedAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      processedAt: { type: "string" },
      processedByAdminId: { type: "string" },
      approvedMinutes: { type: "number" },
      expiresAt: { type: "string" },
      rejectionReason: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "SCRIPTACCESS#${id}" },
      },
      // The admin review queue (prisma: @@index([status])) — same precedent as
      // WithdrawalRequest/Testimonial. byUserId (@@index([userId])) stays a documented
      // gap, same discipline as elsewhere.
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "SCRIPTACCESSSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["requestedAt", "id"], template: "SCRIPTACCESS#${requestedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const Feedback = new Entity(
  {
    model: { entity: "feedback", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string" },
      userEmail: { type: "string", required: true },
      userName: { type: "string", required: true },
      message: { type: "string", required: true },
      pageUrl: { type: "string" },
      status: { type: ["NEW", "REVIEWED", "ARCHIVED"] as const, default: "NEW" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // Platform-wide, not site-scoped — no templateId in the Prisma model.
      primary: {
        pk: { field: "pk", composite: ["id"], template: "FEEDBACK#${id}" },
        sk: { field: "sk", composite: [], template: "FEEDBACK" },
      },
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "FEEDBACKSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "FEEDBACK#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// The Figma-style anchored canvas comments on a template (PlexoBuilder editor) — distinct
// from BlogComment (public blog post comments) above. Scoped by templateId, not postId:
// "list this template's whole comment thread" is the real access pattern (grepped every
// real call site, not assumed) — no status-prefixed SK the way BlogComment has, since
// canvas comments don't go through a moderation queue, just resolved/unresolved in place.
export const Comment = new Entity(
  {
    model: { entity: "comment", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      templateId: { type: "string", required: true },
      authorId: { type: "string", required: true },
      parentId: { type: "string" },
      body: { type: "string", required: true },
      anchorNodeId: { type: "string" },
      anchorNodeType: { type: ["row", "column", "element"] as const },
      anchorX: { type: "number" },
      anchorY: { type: "number" },
      deviceView: { type: ["desktop", "tablet", "mobile"] as const },
      resolvedAt: { type: "string" },
      resolvedById: { type: "string" },
      editedAt: { type: "string" },
      // Soft-delete marker (prisma: Comment.deletedAt) — added here (schemaless attribute
      // add, same discipline as User.strataProjectId elsewhere in this migration) since the
      // app/api/v1/comments/** routes' soft-delete-preserves-thread-integrity behavior
      // depends on it and it was missing from the original port of this entity.
      deletedAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "COMMENT#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Write-only in the real app (grepped — no read call site exists anywhere; it's a pure
// @mention dedup/audit record) — prisma: @@unique([commentId, userId]) becomes the
// primary key itself, so a repeat mention on an edited comment hits .create()'s
// attribute_not_exists condition exactly the way skipDuplicates: true did.
export const CommentMention = new Entity(
  {
    model: { entity: "commentMention", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      commentId: { type: "string", required: true },
      userId: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["commentId"], template: "COMMENT#${commentId}" },
        sk: { field: "sk", composite: ["userId"], template: "MENTION#${userId}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoContentService = new Service(
  {
    Template,
    TemplateRevision,
    TemplateAsset,
    TemplatePurchase,
    PublishedDomain,
    BlogSite,
    SiteLayout,
    BlogAuthor,
    BlogCategory,
    BlogTag,
    BlogPost,
    BlogPostCategory,
    BlogPostTag,
    BlogComment,
    BlogRedirect,
    Testimonial,
    TemplateGenerationJob,
    ScriptAccessRequest,
    Feedback,
    Comment,
    CommentMention,
  },
  { table, client: docClient },
);
