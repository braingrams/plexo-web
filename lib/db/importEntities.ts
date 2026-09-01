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

export const plexoImportService = new Service(
  { ImportJob, ImportMediaMap, SiteImportJob, SiteImportPage, SiteImportAssetBlob, SiteTransferRequest },
  { table, client: docClient },
);
