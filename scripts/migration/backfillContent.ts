/**
 * Postgres -> DynamoDB backfill, Content slice: Template family, PublishedDomain,
 * SiteLayout, SiteTransferRequest, Blog*, canvas Comment/CommentMention,
 * ScriptAccessRequest, Testimonial, Feedback.
 *
 * Same not-run-here caveat as backfillCore.ts / backfillAuthUsers.ts — no DATABASE_URL
 * was ever loaded in this session, and this doesn't run against production without an
 * explicit human decision on timing. Follows backfillCore.ts's exact pattern: batched
 * (PAGE_SIZE), resumable via a JSON checkpoint file, idempotent (ElectroDB .put() is a
 * blind overwrite — safe to re-run over the same rows), dry-run capable.
 *
 * The per-model loop/checkpoint/pagination mechanics are identical for every "simple,
 * bare-`id`-keyed" model below, so that mechanic is factored into one migrateSimple()
 * helper (same checkpoint convention, same dry-run/resume handling, same batch-then-put
 * shape as backfillCore.ts's migrateUsers/migrateOrganizationsAndMembers) instead of being
 * hand-copied 20 times — what's genuinely different per model, and kept fully explicit
 * below, is the Prisma select + the field-for-field map to its ElectroDB entity. The two
 * Prisma many-to-many join tables (BlogPostCategory/BlogPostTag) have no bare `id` column
 * (compound @@id) and need a denormalized templateId pulled from their related BlogPost,
 * so they get their own small dedicated functions instead of migrateSimple().
 *
 * Order matters only in that parents are migrated before children (Template before
 * TemplateRevision/TemplateAsset/etc, BlogPost before BlogPostCategory/BlogPostTag/
 * BlogComment) — DynamoDB itself doesn't enforce referential integrity, this just keeps a
 * partial/interrupted run from looking more orphaned than necessary.
 *
 * Usage: tsx scripts/migration/backfillContent.ts [--dry-run] [--resume]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "@/server/prisma";
import {
  Template,
  TemplateRevision,
  TemplateGenerationJob,
  TemplatePurchase,
  TemplateAsset,
  PublishedDomain,
  SiteLayout,
  BlogSite,
  BlogAuthor,
  BlogCategory,
  BlogTag,
  BlogPost,
  BlogPostCategory,
  BlogPostTag,
  BlogComment,
  BlogRedirect,
  Testimonial,
  ScriptAccessRequest,
  Feedback,
  Comment,
  CommentMention,
} from "@/lib/db/contentEntities";
// SiteTransferRequest lives in plexo-import, not plexo-content (see lib/db/importEntities.ts) —
// its primary key is (templateId, id), matching how lib/siteTransferDynamo.ts already keys it.
import { SiteTransferRequest } from "@/lib/db/importEntities";

const PAGE_SIZE = 200;
const CHECKPOINT_FILE = ".migration-checkpoint-content.json";

type ModelCp = { cursor: string | null; done: boolean };
type JoinCp = { cursor: { a: string; b: string } | null; done: boolean };

type Checkpoint = {
  template: ModelCp;
  templateRevision: ModelCp;
  templateGenerationJob: ModelCp;
  templatePurchase: ModelCp;
  templateAsset: ModelCp;
  publishedDomain: ModelCp;
  siteLayout: ModelCp;
  siteTransferRequest: ModelCp;
  blogSite: ModelCp;
  blogAuthor: ModelCp;
  blogCategory: ModelCp;
  blogTag: ModelCp;
  blogPost: ModelCp;
  blogPostCategory: JoinCp;
  blogPostTag: JoinCp;
  blogComment: ModelCp;
  blogRedirect: ModelCp;
  comment: ModelCp;
  commentMention: ModelCp;
  scriptAccessRequest: ModelCp;
  testimonial: ModelCp;
  feedback: ModelCp;
};

function freshModelCp(): ModelCp {
  return { cursor: null, done: false };
}

function defaultCheckpoint(): Checkpoint {
  return {
    template: freshModelCp(),
    templateRevision: freshModelCp(),
    templateGenerationJob: freshModelCp(),
    templatePurchase: freshModelCp(),
    templateAsset: freshModelCp(),
    publishedDomain: freshModelCp(),
    siteLayout: freshModelCp(),
    siteTransferRequest: freshModelCp(),
    blogSite: freshModelCp(),
    blogAuthor: freshModelCp(),
    blogCategory: freshModelCp(),
    blogTag: freshModelCp(),
    blogPost: freshModelCp(),
    blogPostCategory: { cursor: null, done: false },
    blogPostTag: { cursor: null, done: false },
    blogComment: freshModelCp(),
    blogRedirect: freshModelCp(),
    comment: freshModelCp(),
    commentMention: freshModelCp(),
    scriptAccessRequest: freshModelCp(),
    testimonial: freshModelCp(),
    feedback: freshModelCp(),
  };
}

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return defaultCheckpoint();
}

function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// --- Real, verified value sets for Prisma fields that are plain strings at the DB layer
// but a closed union at the ElectroDB layer (grepped every real write call site, not
// guessed) — same discipline as backfillCore.ts's Member.role check. A row failing one of
// these is real, pre-existing bad data worth surfacing loudly, not silently coercing.

// PublishedDomain.type — plain Prisma String, comment says "SUBDOMAIN" | "CUSTOM"; every
// real write site (app/dashboard/domains/domains-client.tsx, NewSiteWizard.tsx) only ever
// uses these two literals.
const DOMAIN_TYPES = new Set(["SUBDOMAIN", "CUSTOM"]);
function checkDomainType(v: string): "SUBDOMAIN" | "CUSTOM" {
  if (!DOMAIN_TYPES.has(v)) throw new Error(`PublishedDomain has unrecognized type "${v}" — fix data before continuing migration`);
  return v as "SUBDOMAIN" | "CUSTOM";
}

// Comment.anchorNodeType / Comment.deviceView — plain Prisma Strings; app/api/v1/comments/route.ts
// and CommentLayer.tsx's own TypeScript types confirm these are the only real values written.
const ANCHOR_NODE_TYPES = new Set(["row", "column", "element"]);
function checkAnchorNodeType(v: string): "row" | "column" | "element" {
  if (!ANCHOR_NODE_TYPES.has(v)) throw new Error(`Comment has unrecognized anchorNodeType "${v}" — fix data before continuing migration`);
  return v as "row" | "column" | "element";
}
const DEVICE_VIEWS = new Set(["desktop", "tablet", "mobile"]);
function checkDeviceView(v: string): "desktop" | "tablet" | "mobile" {
  if (!DEVICE_VIEWS.has(v)) throw new Error(`Comment has unrecognized deviceView "${v}" — fix data before continuing migration`);
  return v as "desktop" | "tablet" | "mobile";
}

/**
 * Shared driver for every "simple" model: bare `id` primary key in Postgres, one page per
 * loop, checkpoint after every page, done-flag on completion. Mirrors backfillCore.ts's
 * migrateUsers loop exactly — same dry-run guard, same cursor/checkpoint shape, same
 * batch-write-then-log-then-checkpoint order — just parameterized so it isn't retyped once
 * per model. Verified real historical `createdAt`/`updatedAt` values pass through
 * ElectroDB's readOnly attributes fine on `.put()`: readOnly only blocks `.patch()/.update()`
 * (schema.js's checkUpdate), and the `set:` transform on `updatedAt`-style watched
 * attributes only fires on update, not on put/create (clauses.js's `put`/`create` both call
 * checkCreate, which has no readOnly gate at all, and never calls applyAttributeSetters) —
 * confirmed by reading node_modules/electrodb/src/{schema,clauses}.js directly, not assumed.
 */
async function migrateSimple<Row extends { id: string }, Item extends Record<string, unknown>>(
  label: string,
  cp: Checkpoint,
  key: Exclude<keyof Checkpoint, "blogPostCategory" | "blogPostTag">,
  dryRun: boolean,
  fetchPage: (cursor: string | null) => Promise<Row[]>,
  mapItem: (row: Row) => Item,
  put: (items: Item[]) => Promise<unknown>,
): Promise<void> {
  const state = cp[key];
  if (state.done) {
    console.log(`${label}: already complete, skipping`);
    return;
  }

  let cursor = state.cursor;
  let total = 0;

  while (true) {
    const batch = await fetchPage(cursor);
    if (batch.length === 0) break;

    const items = batch.map(mapItem);

    if (!dryRun) {
      // ElectroDB batches internally up to DynamoDB's own 25-item BatchWriteItem limit.
      await put(items);
    }

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`${label}: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);

    state.cursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  state.done = true;
  saveCheckpoint(cp);
  console.log(`${label}: complete, ${total} total`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");

  if (!resume && existsSync(CHECKPOINT_FILE)) {
    throw new Error(
      `${CHECKPOINT_FILE} already exists — pass --resume to continue from it, or delete it to start fresh (only safe if nothing was actually written yet, i.e. a prior --dry-run).`,
    );
  }

  const cp = resume ? loadCheckpoint() : defaultCheckpoint();

  console.log(`Starting content backfill (dryRun=${dryRun}, resume=${resume})`);

  // 1. Template — parent of nearly everything else in this slice.
  await migrateSimple(
    "Template",
    cp,
    "template",
    dryRun,
    (cursor) =>
      prisma.template.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          userId: true,
          organizationId: true,
          name: true,
          kind: true,
          sourceType: true,
          designJson: true,
          compiledHtml: true,
          sdkVersion: true,
          compiledAt: true,
          parentId: true,
          slug: true,
          order: true,
          isOfficial: true,
          marketplaceStatus: true,
          marketplaceCategory: true,
          marketplaceDescription: true,
          priceCents: true,
          marketplacePublishedAt: true,
          marketplaceRejectionReason: true,
          isBlogLayout: true,
          isSiteLayoutFragment: true,
          isCommerceLayout: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    (t) => ({
      id: t.id,
      userId: t.userId,
      organizationId: t.organizationId,
      name: t.name,
      kind: t.kind,
      sourceType: t.sourceType,
      designJson: t.designJson,
      compiledHtml: t.compiledHtml,
      sdkVersion: t.sdkVersion ?? undefined,
      compiledAt: t.compiledAt ? t.compiledAt.toISOString() : undefined,
      parentId: t.parentId ?? undefined,
      slug: t.slug ?? undefined,
      order: t.order,
      isOfficial: t.isOfficial,
      marketplaceStatus: t.marketplaceStatus ?? undefined,
      marketplaceCategory: t.marketplaceCategory ?? undefined,
      marketplaceDescription: t.marketplaceDescription ?? undefined,
      priceCents: t.priceCents ?? undefined,
      marketplacePublishedAt: t.marketplacePublishedAt ? t.marketplacePublishedAt.toISOString() : undefined,
      marketplaceRejectionReason: t.marketplaceRejectionReason ?? undefined,
      isBlogLayout: t.isBlogLayout,
      isSiteLayoutFragment: t.isSiteLayoutFragment,
      isCommerceLayout: t.isCommerceLayout,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }),
    (items) => Template.put(items).go(),
  );

  // 2. TemplateRevision
  await migrateSimple(
    "TemplateRevision",
    cp,
    "templateRevision",
    dryRun,
    (cursor) =>
      prisma.templateRevision.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, templateId: true, designJson: true, compiledHtml: true, sdkVersion: true, createdAt: true },
      }),
    (r) => ({
      id: r.id,
      templateId: r.templateId,
      designJson: r.designJson,
      compiledHtml: r.compiledHtml,
      sdkVersion: r.sdkVersion,
      createdAt: r.createdAt.toISOString(),
    }),
    (items) => TemplateRevision.put(items).go(),
  );

  // 3. TemplateGenerationJob — platform-wide, not templateId-scoped.
  await migrateSimple(
    "TemplateGenerationJob",
    cp,
    "templateGenerationJob",
    dryRun,
    (cursor) =>
      prisma.templateGenerationJob.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          status: true,
          kind: true,
          isOptIn: true,
          category: true,
          priceCents: true,
          targetStatus: true,
          provider: true,
          requestedCount: true,
          succeededCount: true,
          failedCount: true,
          createdTemplateIds: true,
          errors: true,
          lockedAt: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    (j) => ({
      id: j.id,
      status: j.status,
      kind: j.kind,
      isOptIn: j.isOptIn,
      category: j.category,
      priceCents: j.priceCents,
      targetStatus: j.targetStatus,
      provider: j.provider,
      requestedCount: j.requestedCount,
      succeededCount: j.succeededCount,
      failedCount: j.failedCount,
      createdTemplateIds: j.createdTemplateIds,
      errors: j.errors ?? undefined,
      lockedAt: j.lockedAt ? j.lockedAt.toISOString() : undefined,
      createdBy: j.createdBy ?? undefined,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    }),
    (items) => TemplateGenerationJob.put(items).go(),
  );

  // 4. TemplatePurchase
  await migrateSimple(
    "TemplatePurchase",
    cp,
    "templatePurchase",
    dryRun,
    (cursor) =>
      prisma.templatePurchase.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, userId: true, templateId: true, priceCentsPaid: true, stripeSessionId: true, createdAt: true },
      }),
    (p) => ({
      id: p.id,
      userId: p.userId,
      templateId: p.templateId,
      priceCentsPaid: p.priceCentsPaid,
      stripeSessionId: p.stripeSessionId ?? undefined,
      createdAt: p.createdAt.toISOString(),
    }),
    (items) => TemplatePurchase.put(items).go(),
  );

  // 5. TemplateAsset
  await migrateSimple(
    "TemplateAsset",
    cp,
    "templateAsset",
    dryRun,
    (cursor) =>
      prisma.templateAsset.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, templateId: true, path: true, blobUrl: true, contentType: true, size: true, createdAt: true },
      }),
    (a) => ({
      id: a.id,
      templateId: a.templateId,
      path: a.path,
      blobUrl: a.blobUrl,
      contentType: a.contentType,
      size: a.size,
      createdAt: a.createdAt.toISOString(),
    }),
    (items) => TemplateAsset.put(items).go(),
  );

  // 6. PublishedDomain
  await migrateSimple(
    "PublishedDomain",
    cp,
    "publishedDomain",
    dryRun,
    (cursor) =>
      prisma.publishedDomain.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          userId: true,
          organizationId: true,
          templateId: true,
          domain: true,
          type: true,
          dnsVerified: true,
          dnsVerifiedAt: true,
          active: true,
          suspendedAt: true,
          suspendedReason: true,
          flagged: true,
          flagReason: true,
          lastScannedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    (d) => ({
      id: d.id,
      userId: d.userId,
      organizationId: d.organizationId,
      templateId: d.templateId,
      domain: d.domain,
      type: checkDomainType(d.type),
      dnsVerified: d.dnsVerified,
      dnsVerifiedAt: d.dnsVerifiedAt ? d.dnsVerifiedAt.toISOString() : undefined,
      active: d.active,
      suspendedAt: d.suspendedAt ? d.suspendedAt.toISOString() : undefined,
      suspendedReason: d.suspendedReason ?? undefined,
      flagged: d.flagged,
      flagReason: d.flagReason ?? undefined,
      lastScannedAt: d.lastScannedAt ? d.lastScannedAt.toISOString() : undefined,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }),
    (items) => PublishedDomain.put(items).go(),
  );

  // 7. SiteLayout
  await migrateSimple(
    "SiteLayout",
    cp,
    "siteLayout",
    dryRun,
    (cursor) =>
      prisma.siteLayout.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          templateId: true,
          organizationId: true,
          enabled: true,
          headerTemplateId: true,
          footerTemplateId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    (s) => ({
      id: s.id,
      templateId: s.templateId,
      organizationId: s.organizationId,
      enabled: s.enabled,
      headerTemplateId: s.headerTemplateId ?? undefined,
      footerTemplateId: s.footerTemplateId ?? undefined,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }),
    (items) => SiteLayout.put(items).go(),
  );

  // 8. SiteTransferRequest — plexo-import table, composite (templateId, id) primary key.
  await migrateSimple(
    "SiteTransferRequest",
    cp,
    "siteTransferRequest",
    dryRun,
    (cursor) =>
      prisma.siteTransferRequest.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          templateId: true,
          fromOrganizationId: true,
          fromUserId: true,
          toEmail: true,
          toUserId: true,
          status: true,
          token: true,
          compatibilityWarnings: true,
          createdAt: true,
          respondedAt: true,
          expiresAt: true,
        },
      }),
    (r) => ({
      id: r.id,
      templateId: r.templateId,
      fromOrganizationId: r.fromOrganizationId,
      fromUserId: r.fromUserId,
      toEmail: r.toEmail,
      toUserId: r.toUserId ?? undefined,
      status: r.status,
      token: r.token,
      compatibilityWarnings: r.compatibilityWarnings ?? undefined,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : undefined,
      expiresAt: r.expiresAt.toISOString(),
    }),
    (items) => SiteTransferRequest.put(items).go(),
  );

  // 9. BlogSite
  await migrateSimple(
    "BlogSite",
    cp,
    "blogSite",
    dryRun,
    (cursor) =>
      prisma.blogSite.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          templateId: true,
          enabled: true,
          title: true,
          description: true,
          postsPerPage: true,
          defaultCategoryId: true,
          showOnHomepage: true,
          accentColor: true,
          fontPreset: true,
          logoUrl: true,
          headerImageUrl: true,
          postLayoutTemplateId: true,
          listingLayoutTemplateId: true,
          commentsEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    (b) => ({
      id: b.id,
      templateId: b.templateId,
      enabled: b.enabled,
      title: b.title,
      description: b.description ?? undefined,
      postsPerPage: b.postsPerPage,
      defaultCategoryId: b.defaultCategoryId ?? undefined,
      showOnHomepage: b.showOnHomepage,
      accentColor: b.accentColor ?? undefined,
      fontPreset: b.fontPreset,
      logoUrl: b.logoUrl ?? undefined,
      headerImageUrl: b.headerImageUrl ?? undefined,
      postLayoutTemplateId: b.postLayoutTemplateId ?? undefined,
      listingLayoutTemplateId: b.listingLayoutTemplateId ?? undefined,
      commentsEnabled: b.commentsEnabled,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }),
    (items) => BlogSite.put(items).go(),
  );

  // 10. BlogAuthor
  await migrateSimple(
    "BlogAuthor",
    cp,
    "blogAuthor",
    dryRun,
    (cursor) =>
      prisma.blogAuthor.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, templateId: true, userId: true, name: true, slug: true, avatarUrl: true, bio: true, createdAt: true, updatedAt: true },
      }),
    (a) => ({
      id: a.id,
      templateId: a.templateId,
      userId: a.userId ?? undefined,
      name: a.name,
      slug: a.slug,
      avatarUrl: a.avatarUrl ?? undefined,
      bio: a.bio ?? undefined,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }),
    (items) => BlogAuthor.put(items).go(),
  );

  // 11. BlogCategory — no updatedAt in either Prisma or the entity.
  await migrateSimple(
    "BlogCategory",
    cp,
    "blogCategory",
    dryRun,
    (cursor) =>
      prisma.blogCategory.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, templateId: true, name: true, slug: true, description: true, parentId: true, createdAt: true },
      }),
    (c) => ({
      id: c.id,
      templateId: c.templateId,
      name: c.name,
      slug: c.slug,
      description: c.description ?? undefined,
      parentId: c.parentId ?? undefined,
      createdAt: c.createdAt.toISOString(),
    }),
    (items) => BlogCategory.put(items).go(),
  );

  // 12. BlogTag — no updatedAt in either Prisma or the entity.
  await migrateSimple(
    "BlogTag",
    cp,
    "blogTag",
    dryRun,
    (cursor) =>
      prisma.blogTag.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, templateId: true, name: true, slug: true, createdAt: true },
      }),
    (t) => ({ id: t.id, templateId: t.templateId, name: t.name, slug: t.slug, createdAt: t.createdAt.toISOString() }),
    (items) => BlogTag.put(items).go(),
  );

  // 13. BlogPost
  await migrateSimple(
    "BlogPost",
    cp,
    "blogPost",
    dryRun,
    (cursor) =>
      prisma.blogPost.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          templateId: true,
          authorId: true,
          title: true,
          slug: true,
          excerpt: true,
          contentJson: true,
          contentHtml: true,
          featuredImageUrl: true,
          featuredImageAlt: true,
          status: true,
          publishedAt: true,
          scheduledAt: true,
          metaTitle: true,
          metaDescription: true,
          ogImageUrl: true,
          noindex: true,
          readingTimeMinutes: true,
          viewCount: true,
          externalId: true,
          commentsEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    (p) => ({
      id: p.id,
      templateId: p.templateId,
      authorId: p.authorId ?? undefined,
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? undefined,
      contentJson: p.contentJson,
      contentHtml: p.contentHtml,
      featuredImageUrl: p.featuredImageUrl ?? undefined,
      featuredImageAlt: p.featuredImageAlt ?? undefined,
      status: p.status,
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : undefined,
      scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : undefined,
      metaTitle: p.metaTitle ?? undefined,
      metaDescription: p.metaDescription ?? undefined,
      ogImageUrl: p.ogImageUrl ?? undefined,
      noindex: p.noindex,
      readingTimeMinutes: p.readingTimeMinutes ?? undefined,
      viewCount: p.viewCount,
      externalId: p.externalId ?? undefined,
      commentsEnabled: p.commentsEnabled,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }),
    (items) => BlogPost.put(items).go(),
  );

  // 14. BlogPostCategory — Prisma many-to-many join, compound @@id([postId, categoryId]),
  // no bare `id` column and no createdAt. The ElectroDB entity denormalizes templateId
  // (not in Prisma) for co-location, pulled here from the related BlogPost.
  await migrateBlogPostCategory(dryRun, cp);

  // 15. BlogPostTag — same join-table shape as BlogPostCategory.
  await migrateBlogPostTag(dryRun, cp);

  // 16. BlogComment — no updatedAt in either Prisma or the entity.
  await migrateSimple(
    "BlogComment",
    cp,
    "blogComment",
    dryRun,
    (cursor) =>
      prisma.blogComment.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, postId: true, parentId: true, authorName: true, authorEmail: true, body: true, status: true, ipHash: true, createdAt: true },
      }),
    (c) => ({
      id: c.id,
      postId: c.postId,
      parentId: c.parentId ?? undefined,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      body: c.body,
      status: c.status,
      ipHash: c.ipHash ?? undefined,
      createdAt: c.createdAt.toISOString(),
    }),
    (items) => BlogComment.put(items).go(),
  );

  // 17. BlogRedirect — ~1858 rows, the largest table in this migration; no special
  // handling needed, batched paging is trivial at this volume.
  await migrateSimple(
    "BlogRedirect",
    cp,
    "blogRedirect",
    dryRun,
    (cursor) =>
      prisma.blogRedirect.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, templateId: true, fromPath: true, toPath: true, createdAt: true },
      }),
    (r) => ({ id: r.id, templateId: r.templateId, fromPath: r.fromPath, toPath: r.toPath, createdAt: r.createdAt.toISOString() }),
    (items) => BlogRedirect.put(items).go(),
  );

  // 18. Comment — Figma-style canvas comments. NOTE: Comment's ElectroDB entity
  // (lib/db/contentEntities.ts) has no `updatedAt` attribute at all, even though Prisma's
  // Comment.updatedAt (@updatedAt) is a real column — this is a genuine field the target
  // schema drops, not something this script can smuggle in without touching
  // contentEntities.ts (out of scope for this script). Flagged in the migration report,
  // not silently ignored: real historical updatedAt values for canvas comments are lost.
  await migrateSimple(
    "Comment",
    cp,
    "comment",
    dryRun,
    (cursor) =>
      prisma.comment.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          organizationId: true,
          templateId: true,
          authorId: true,
          parentId: true,
          body: true,
          anchorNodeId: true,
          anchorNodeType: true,
          anchorX: true,
          anchorY: true,
          deviceView: true,
          resolvedAt: true,
          resolvedById: true,
          editedAt: true,
          deletedAt: true,
          createdAt: true,
          // updatedAt intentionally not selected — see the flagged gap above.
        },
      }),
    (c) => ({
      id: c.id,
      organizationId: c.organizationId,
      templateId: c.templateId,
      authorId: c.authorId,
      parentId: c.parentId ?? undefined,
      body: c.body,
      anchorNodeId: c.anchorNodeId ?? undefined,
      anchorNodeType: c.anchorNodeType ? checkAnchorNodeType(c.anchorNodeType) : undefined,
      anchorX: c.anchorX ?? undefined,
      anchorY: c.anchorY ?? undefined,
      deviceView: c.deviceView ? checkDeviceView(c.deviceView) : undefined,
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : undefined,
      resolvedById: c.resolvedById ?? undefined,
      editedAt: c.editedAt ? c.editedAt.toISOString() : undefined,
      deletedAt: c.deletedAt ? c.deletedAt.toISOString() : undefined,
      createdAt: c.createdAt.toISOString(),
    }),
    (items) => Comment.put(items).go(),
  );

  // 19. CommentMention
  await migrateSimple(
    "CommentMention",
    cp,
    "commentMention",
    dryRun,
    (cursor) =>
      prisma.commentMention.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, commentId: true, userId: true, createdAt: true },
      }),
    (m) => ({ id: m.id, commentId: m.commentId, userId: m.userId, createdAt: m.createdAt.toISOString() }),
    (items) => CommentMention.put(items).go(),
  );

  // 20. ScriptAccessRequest — real historical timestamp lives in `requestedAt`, not
  // `createdAt` (this model has no createdAt column at all).
  await migrateSimple(
    "ScriptAccessRequest",
    cp,
    "scriptAccessRequest",
    dryRun,
    (cursor) =>
      prisma.scriptAccessRequest.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          templateId: true,
          userId: true,
          reason: true,
          status: true,
          requestedAt: true,
          processedAt: true,
          processedByAdminId: true,
          approvedMinutes: true,
          expiresAt: true,
          rejectionReason: true,
        },
      }),
    (r) => ({
      id: r.id,
      templateId: r.templateId,
      userId: r.userId,
      reason: r.reason ?? undefined,
      status: r.status,
      requestedAt: r.requestedAt.toISOString(),
      processedAt: r.processedAt ? r.processedAt.toISOString() : undefined,
      processedByAdminId: r.processedByAdminId ?? undefined,
      approvedMinutes: r.approvedMinutes ?? undefined,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : undefined,
      rejectionReason: r.rejectionReason ?? undefined,
    }),
    (items) => ScriptAccessRequest.put(items).go(),
  );

  // 21. Testimonial — platform-wide, not templateId-scoped.
  await migrateSimple(
    "Testimonial",
    cp,
    "testimonial",
    dryRun,
    (cursor) =>
      prisma.testimonial.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, quote: true, name: true, role: true, company: true, avatarUrl: true, rating: true, status: true, createdAt: true, updatedAt: true },
      }),
    (t) => ({
      id: t.id,
      quote: t.quote,
      name: t.name,
      role: t.role,
      company: t.company ?? undefined,
      avatarUrl: t.avatarUrl ?? undefined,
      rating: t.rating,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }),
    (items) => Testimonial.put(items).go(),
  );

  // 22. Feedback — platform-wide, not templateId-scoped.
  await migrateSimple(
    "Feedback",
    cp,
    "feedback",
    dryRun,
    (cursor) =>
      prisma.feedback.findMany({
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, userId: true, userEmail: true, userName: true, message: true, pageUrl: true, status: true, createdAt: true },
      }),
    (f) => ({
      id: f.id,
      userId: f.userId ?? undefined,
      userEmail: f.userEmail,
      userName: f.userName,
      message: f.message,
      pageUrl: f.pageUrl ?? undefined,
      status: f.status,
      createdAt: f.createdAt.toISOString(),
    }),
    (items) => Feedback.put(items).go(),
  );

  console.log("Content backfill complete.");
}

// --- Join tables: compound Prisma primary key, no bare `id`, denormalized templateId ---

async function migrateBlogPostCategory(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.blogPostCategory;
  if (state.done) {
    console.log("BlogPostCategory: already complete, skipping");
    return;
  }

  let cursor = state.cursor;
  let total = 0;

  while (true) {
    const batch = await prisma.blogPostCategory.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { postId_categoryId: { postId: cursor.a, categoryId: cursor.b } } } : {}),
      orderBy: [{ postId: "asc" }, { categoryId: "asc" }],
      select: { postId: true, categoryId: true, post: { select: { templateId: true } } },
    });

    if (batch.length === 0) break;

    const items = batch.map((r) => ({
      templateId: r.post.templateId,
      postId: r.postId,
      categoryId: r.categoryId,
    }));

    if (!dryRun) {
      await BlogPostCategory.put(items).go();
    }

    total += items.length;
    const last = batch[batch.length - 1];
    cursor = { a: last.postId, b: last.categoryId };
    console.log(`BlogPostCategory: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor.a}/${cursor.b}`);

    state.cursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  state.done = true;
  saveCheckpoint(cp);
  console.log(`BlogPostCategory: complete, ${total} total`);
}

async function migrateBlogPostTag(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.blogPostTag;
  if (state.done) {
    console.log("BlogPostTag: already complete, skipping");
    return;
  }

  let cursor = state.cursor;
  let total = 0;

  while (true) {
    const batch = await prisma.blogPostTag.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { postId_tagId: { postId: cursor.a, tagId: cursor.b } } } : {}),
      orderBy: [{ postId: "asc" }, { tagId: "asc" }],
      select: { postId: true, tagId: true, post: { select: { templateId: true } } },
    });

    if (batch.length === 0) break;

    const items = batch.map((r) => ({
      templateId: r.post.templateId,
      postId: r.postId,
      tagId: r.tagId,
    }));

    if (!dryRun) {
      await BlogPostTag.put(items).go();
    }

    total += items.length;
    const last = batch[batch.length - 1];
    cursor = { a: last.postId, b: last.tagId };
    console.log(`BlogPostTag: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor.a}/${cursor.b}`);

    state.cursor = cursor;
    saveCheckpoint(cp);

    if (batch.length < PAGE_SIZE) break;
  }

  state.done = true;
  saveCheckpoint(cp);
  console.log(`BlogPostTag: complete, ${total} total`);
}

main()
  .catch((err) => {
    console.error("Content backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
