import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-import — transient job state, all TTL-tagged so it self-cleans without a cron.
// Field shapes ported 1:1 from schema.prisma.

const table = TABLES.import;
// 90 days is generous for a completed/failed import's audit trail while still being a
// real bound — these are job records, not permanent business data like everything in
// plexo-content.
const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;
const ttlFromNow = (): number => Math.floor(Date.now() / 1000) + NINETY_DAYS_SECONDS;

export const ImportJob = new Entity(
  {
    model: { entity: "importJob", version: "1", service: "plexoImport" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      sourceType: { type: ["WP_REST", "WXR_UPLOAD"] as const, required: true },
      sourceUrl: { type: "string" },
      wxrBlobUrl: { type: "string" },
      status: {
        type: ["PENDING", "DISCOVERING", "RUNNING", "PAUSED_ERROR", "COMPLETED", "FAILED", "CANCELLED"] as const,
        default: "PENDING",
      },
      mediaHandling: { type: ["RETAIN", "REHOST"] as const, default: "RETAIN" },
      processing: { type: "boolean", default: false },
      cursor: { type: "any" },
      totalPosts: { type: "number" },
      processedPosts: { type: "number", default: 0 },
      totalMedia: { type: "number" },
      processedMedia: { type: "number", default: 0 },
      errors: { type: "any" },
      lastHeartbeatAt: { type: "string" },
      createdBy: { type: "string" },
      startedAt: { type: "string" },
      finishedAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
      ttl: { type: "number", default: ttlFromNow },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "IMPORTJOB#${id}" },
      },
      // Resume-stalled-jobs cron needs this (prisma: @@index([status])).
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "IMPORTSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["lastHeartbeatAt", "id"], template: "IMPORTJOB#${lastHeartbeatAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const ImportMediaMap = new Entity(
  {
    model: { entity: "importMediaMap", version: "1", service: "plexoImport" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      sourceUrl: { type: "string", required: true },
      blobUrl: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      ttl: { type: "number", default: ttlFromNow },
    },
    indexes: {
      // sourceUrl as SK enforces @@unique([templateId, sourceUrl]) for free.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["sourceUrl"], template: "MEDIAMAP#${sourceUrl}" },
      },
    },
  },
  { table, client: docClient },
);

export const SiteImportJob = new Entity(
  {
    model: { entity: "siteImportJob", version: "1", service: "plexoImport" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      sourceUrl: { type: "string", required: true },
      platform: { type: ["WORDPRESS", "SQUARESPACE", "WIX", "WEBFLOW", "UNKNOWN"] as const, default: "UNKNOWN" },
      importBlogPosts: { type: "boolean", default: false },
      mediaHandling: { type: ["RETAIN", "REHOST"] as const, default: "REHOST" },
      phase: {
        type: ["PENDING", "DETECTING", "DISCOVERING", "FETCHING", "REWRITING", "COMPLETED", "PAUSED_ERROR", "FAILED", "CANCELLED"] as const,
        default: "PENDING",
      },
      processing: { type: "boolean", default: false },
      lastHeartbeatAt: { type: "string" },
      ownershipAttestedAt: { type: "string" },
      ownershipAttestedBy: { type: "string" },
      urlMap: { type: "any" },
      totalPages: { type: "number" },
      processedPages: { type: "number", default: 0 },
      totalAssets: { type: "number" },
      processedAssets: { type: "number", default: 0 },
      errors: { type: "any" },
      warnings: { type: "any" },
      createdBy: { type: "string" },
      startedAt: { type: "string" },
      finishedAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
      ttl: { type: "number", default: ttlFromNow },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "SITEIMPORT#${id}" },
      },
      // Prisma's own comment on this field says exactly why: "denormalized from Template
      // for cheap org-scoped rate-limit queries" — this GSI is that query.
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "SITEIMPORT#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const SiteImportPage = new Entity(
  {
    model: { entity: "siteImportPage", version: "1", service: "plexoImport" },
    attributes: {
      id: { type: "string", required: true },
      jobId: { type: "string", required: true },
      sourceUrl: { type: "string", required: true },
      isBlogPost: { type: "boolean", default: false },
      outcome: {
        type: ["PENDING", "PAGE_CREATED", "POST_CREATED", "SKIPPED_DUPLICATE", "FAILED", "EXCLUDED"] as const,
        default: "PENDING",
      },
      createdTemplateId: { type: "string" },
      createdBlogPostId: { type: "string" },
      usedHeadless: { type: "boolean", default: false },
      heuristicExtraction: { type: "boolean", default: false },
      interactiveFeatureFlags: { type: "any" },
      rewrittenAt: { type: "string" },
      error: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
      ttl: { type: "number", default: ttlFromNow },
    },
    indexes: {
      // sourceUrl as SK enforces @@unique([jobId, sourceUrl]) for free. Filtering by
      // outcome (prisma: @@index([jobId, outcome])) stays a query+filter within one
      // job's partition — an admin/debug view, not a hot path, doesn't earn a GSI.
      primary: {
        pk: { field: "pk", composite: ["jobId"], template: "SITEIMPORT#${jobId}" },
        sk: { field: "sk", composite: ["sourceUrl"], template: "PAGE#${sourceUrl}" },
      },
    },
  },
  { table, client: docClient },
);

export const SiteImportAssetBlob = new Entity(
  {
    model: { entity: "siteImportAssetBlob", version: "1", service: "plexoImport" },
    attributes: {
      id: { type: "string", required: true },
      jobId: { type: "string", required: true },
      sha256: { type: "string", required: true },
      blobUrl: { type: "string", required: true },
      contentType: { type: "string", required: true },
      size: { type: "number", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      ttl: { type: "number", default: ttlFromNow },
    },
    indexes: {
      // sha256 as SK enforces @@unique([jobId, sha256]) for free.
      primary: {
        pk: { field: "pk", composite: ["jobId"], template: "SITEIMPORT#${jobId}" },
        sk: { field: "sk", composite: ["sha256"], template: "ASSETBLOB#${sha256}" },
      },
    },
  },
  { table, client: docClient },
);

// Not TTL'd like the rest of this table — a site-transfer request is a real, if
// short-lived, business action (someone's giving away a site) with its own explicit
// expiresAt the app already checks; letting DynamoDB TTL-delete it independently would
// silently destroy the audit trail of who transferred what to whom.
export const SiteTransferRequest = new Entity(
  {
    model: { entity: "siteTransferRequest", version: "1", service: "plexoImport" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      fromOrganizationId: { type: "string", required: true },
      fromUserId: { type: "string", required: true },
      toEmail: { type: "string", required: true },
      toUserId: { type: "string" },
      status: { type: ["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"] as const, default: "PENDING" },
      token: { type: "string", required: true },
      compatibilityWarnings: { type: "any" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      respondedAt: { type: "string" },
      expiresAt: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "TRANSFER#${id}" },
      },
      // The critical unauthenticated lookup: a recipient clicking their accept-link
      // (prisma: token @unique) needs this resolved directly, before they're even
      // signed in.
      byToken: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["token"], template: "TRANSFERTOKEN#${token}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "TRANSFER#${id}" },
      },
    },
  },
  { table, client: docClient },
);
// toEmail lookup (prisma: @@index([toEmail]) — "my pending incoming transfers") stays a
// documented gap for the same reason as several others: real, but a GSI2 candidate for
// when it's actually implemented, not spent speculatively now.

// ── WordPress migration (lib/wpMigration) ────────────────────────────────────────
// A migration's report is what the owner checks before deleting their WordPress site, so
// it outlives the 90-day job TTL above — a year covers "migrated, sat on it, came back to
// switch the domain" comfortably.
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const migrationTtl = (): number => Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS;

export const WP_MIGRATION_PHASES = [
  "PENDING", "PLANNING", "PAGES", "POSTS", "ASSETS", "FINALIZING", "COMPLETED", "PAUSED_ERROR", "FAILED", "CANCELLED",
] as const;

export const WpMigrationJob = new Entity(
  {
    model: { entity: "wpMigrationJob", version: "1", service: "plexoImport" },
    attributes: {
      id: { type: "string", required: true },
      /** The Plexo site (root Template) being built from the WordPress site. */
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      createdBy: { type: "string", required: true },
      sourceUrl: { type: "string", required: true },
      /** WpInstall (lib/wpMigration/types.ts) — where WordPress was found. */
      install: { type: "any" },
      phase: { type: WP_MIGRATION_PHASES, default: "PENDING" },
      processing: { type: "boolean", default: false },
      lastHeartbeatAt: { type: "string" },
      ownershipAttestedAt: { type: "string" },
      /** pageKey → Template id for every node of the migrated page tree. */
      nodes: { type: "any" },
      /** Old path → new path for content whose URL moved (posts → /blog/<slug>). */
      movedLinks: { type: "any" },
      /** { pages, pagesDone, posts, postsDone, assets, assetsDone, assetsFailed } */
      counts: { type: "any" },
      /** Working state carried between phases — see lib/wpMigration/runJobDynamo.ts's PlanState. */
      planState: { type: "any" },
      /** DetectedPlugin[] — what happened to each WordPress plugin. */
      plugins: { type: "any" },
      /** Final verification report, written by the FINALIZING phase. */
      report: { type: "any" },
      errors: { type: "any" },
      warnings: { type: "any" },
      startedAt: { type: "string" },
      finishedAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
      ttl: { type: "number", default: migrationTtl },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "WPMIGRATION#${id}" },
      },
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "WPMIGRATION#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

/** One migrated URL — a WordPress page, a static page in front of WordPress, or a blog post. */
export const WpMigrationPage = new Entity(
  {
    model: { entity: "wpMigrationPage", version: "1", service: "plexoImport" },
    attributes: {
      id: { type: "string", required: true },
      jobId: { type: "string", required: true },
      /** pageKey() of the source URL for pages, "post:<wpId>" for posts. */
      key: { type: "string", required: true },
      kind: { type: ["WP_PAGE", "STATIC_PAGE", "POST"] as const, required: true },
      sourceUrl: { type: "string", required: true },
      title: { type: "string" },
      wpId: { type: "number" },
      status: { type: ["PENDING", "DONE", "FAILED"] as const, default: "PENDING" },
      /** Where it lives on Plexo now. */
      newPath: { type: "string" },
      templateId: { type: "string" },
      blogPostId: { type: "string" },
      /** Post payload (WpPostEntry) carried from PLANNING to POSTS so the API isn't read twice. */
      data: { type: "any" },
      sourceFacts: { type: "any" },
      newFacts: { type: "any" },
      forms: { type: "any" },
      unmigratedForms: { type: "any" },
      loginForms: { type: "number" },
      searchForms: { type: "number" },
      internalLinks: { type: "any" },
      pluginSlugs: { type: "any" },
      assetCount: { type: "number" },
      error: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
      ttl: { type: "number", default: migrationTtl },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["jobId"], template: "WPMIGRATION#${jobId}" },
        sk: { field: "sk", composite: ["key"], template: "PAGE#${key}" },
      },
    },
  },
  { table, client: docClient },
);

/** One file in the mirrored URL space (theme/plugin CSS/JS/fonts, media) and where it was stored. */
export const WpMigrationAsset = new Entity(
  {
    model: { entity: "wpMigrationAsset", version: "1", service: "plexoImport" },
    attributes: {
      id: { type: "string", required: true },
      jobId: { type: "string", required: true },
      /** Decoded site-relative path without leading slash ("lineagecare/wp-content/uploads/a.jpg"). */
      path: { type: "string", required: true },
      status: { type: ["PENDING", "DONE", "FAILED", "SKIPPED"] as const, default: "PENDING" },
      /** Where it was first referenced — a page key, a stylesheet path, or "media-library". */
      discoveredFrom: { type: "string" },
      ownerTemplateId: { type: "string" },
      relPath: { type: "string" },
      contentType: { type: "string" },
      size: { type: "number" },
      error: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
      ttl: { type: "number", default: migrationTtl },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["jobId"], template: "WPMIGRATION#${jobId}" },
        sk: { field: "sk", composite: ["path"], template: "ASSET#${path}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoImportService = new Service(
  { ImportJob, ImportMediaMap, SiteImportJob, SiteImportPage, SiteImportAssetBlob, SiteTransferRequest, WpMigrationJob, WpMigrationPage, WpMigrationAsset },
  { table, client: docClient },
);
