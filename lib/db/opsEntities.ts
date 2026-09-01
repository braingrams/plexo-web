import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-ops. Field shapes ported 1:1 from schema.prisma.
//
// Correction to the original roadmap's "TTL-heavy by design" framing: AdminAuditLog and
// FormSubmission are real, permanent data (a compliance trail; a site owner's actual
// contact-form leads) — not ephemeral operational noise like PageView/RateLimit/
// StockCache. DynamoDB's TTL is opt-in per item even though the table designates one
// attribute name for it (see cdk/lib/data-stack.ts) — these two entities simply never
// populate `ttl`, so they're never auto-deleted, while the other three are.

const table = TABLES.ops;

const days = (n: number): number => Math.floor(Date.now() / 1000) + n * 24 * 60 * 60;
const hours = (n: number): number => Math.floor(Date.now() / 1000) + n * 60 * 60;

export const PageView = new Entity(
  {
    model: { entity: "pageView", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      domain: { type: "string" },
      ipHash: { type: "string" },
      userAgent: { type: "string" },
      country: { type: "string" },
      region: { type: "string" },
      city: { type: "string" },
      deviceType: { type: "string" },
      browser: { type: "string" },
      os: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // 180 days — enough for year-over-year-lite comparisons on a dashboard without
      // unbounded analytics growth, matching the original cost model's assumption.
      ttl: { type: "number", default: () => days(180) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "PAGEVIEW#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const RateLimit = new Entity(
  {
    model: { entity: "rateLimit", version: "1", service: "plexoOps" },
    attributes: {
      key: { type: "string", required: true },
      count: { type: "number", required: true, default: 0 },
      lastRequest: { type: "number", required: true },
      // 1 hour — rate-limit windows are short-lived by nature; a stale counter beyond
      // its window is meaningless and should vanish, not accumulate.
      ttl: { type: "number", default: () => hours(1) },
    },
    indexes: {
      // Single item per key — no separate id needed the way Prisma's cuid() gave it one;
      // the key itself IS the natural, sufficient primary key.
      primary: {
        pk: { field: "pk", composite: ["key"], template: "RATELIMIT#${key}" },
        sk: { field: "sk", composite: [], template: "RATELIMIT" },
      },
    },
  },
  { table, client: docClient },
);

export const StockCache = new Entity(
  {
    model: { entity: "stockCache", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      provider: { type: "string", required: true },
      query: { type: "string", required: true },
      results: { type: "any", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // 7 days — a stock-photo search-result cache going stale after a week is fine;
      // permanent caching isn't worth the storage for search terms that rarely repeat.
      ttl: { type: "number", default: () => days(7) },
    },
    indexes: {
      // provider+query as the key enforces @@unique([provider, query]) for free.
      primary: {
        pk: { field: "pk", composite: ["provider", "query"], template: "STOCKCACHE#${provider}#${query}" },
        sk: { field: "sk", composite: [], template: "STOCKCACHE" },
      },
    },
  },
  { table, client: docClient },
);

export const AdminAuditLog = new Entity(
  {
    model: { entity: "adminAuditLog", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      actorId: { type: "string", required: true },
      action: { type: "string", required: true },
      targetType: { type: "string", required: true },
      targetId: { type: "string", required: true },
      metadata: { type: "any" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // No ttl attribute populated — see file header. A compliance/audit trail must not
      // silently disappear.
    },
    indexes: {
      // "what has this admin done" (prisma: @@index([actorId])).
      primary: {
        pk: { field: "pk", composite: ["actorId"], template: "ACTOR#${actorId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "AUDIT#${createdAt}#${id}" },
      },
      // "what has happened to this target" (prisma: @@index([targetType, targetId])) —
      // e.g. every admin action ever taken on a specific user or org.
      byTarget: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["targetType", "targetId"], template: "TARGET#${targetType}#${targetId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "AUDIT#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);
// createdAt-only listing (prisma: @@index([createdAt]) — a platform-wide activity feed
// across all admins) stays a documented gap, same "real but didn't earn the GSI slot"
// discipline as elsewhere — actorId and target are the two patterns actually exercised.

export const FormSubmission = new Entity(
  {
    model: { entity: "formSubmission", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      formName: { type: "string", default: "Website Form" },
      fields: { type: "any", required: true },
      submitterIp: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // No ttl attribute populated — see file header. These are a site owner's real
      // contact-form leads, not disposable operational data.
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "SUBMISSION#${createdAt}#${id}" },
      },
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "SUBMISSION#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoOpsService = new Service(
  { PageView, RateLimit, StockCache, AdminAuditLog, FormSubmission },
  { table, client: docClient },
);
