import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-content. Hosting-platform entities — sites deployed as framework builds rather
// than Plexo builder pages. Co-located under TEMPLATE#${templateId} so a single PK read
// gives you both the Template metadata and the deployment state for any given site.

const table = TABLES.content;

export type RedirectRule = {
  from: string;   // path pattern — supports a single trailing wildcard segment (*)
  to: string;     // destination — may include :splat for the wildcard capture
  status: number; // 301, 302, 307, 308 only (200 proxy not supported in Phase 1)
};

// One per published site — represents "this domain/template is a deployed framework app,
// not a Plexo builder site." The pub handler checks for this entity first; if present,
// it takes over completely and the builder/RAW_UPLOAD path never runs.
export const DeployedApp = new Entity(
  {
    model: { entity: "deployedApp", version: "1", service: "plexoContent" },
    attributes: {
      templateId: { type: "string", required: true },
      // Only STATIC is implemented in Phase 1; SSR placeholder added now so the entity
      // shape doesn't need migration when Phase 3 ships.
      type: { type: ["STATIC", "SSR"] as const, required: true, default: "STATIC" },
      // Path prefix within the USER_CONTENT_BUCKET (without the "public/" prefix that
      // uploadObject adds). Stored without leading/trailing slashes. Example:
      // "deployedApps/tmpl_abc123" → actual S3 key "public/deployedApps/tmpl_abc123/index.html"
      s3Prefix: { type: "string" },
      // When true, any path that doesn't resolve to a real file falls back to index.html.
      // Set automatically during upload detection (SPAs → true, MPAs → false).
      spaMode: { type: "boolean", default: false },
      // Parsed _redirects file rules, stored as JSON. Null means no redirect rules.
      redirectRules: { type: "any" },
      // Framework detected from the zip's output structure at upload time.
      framework: { type: "string" },
      // Pointer to the most recent Deployment entity (Phase 2). Null until then.
      activeDeploymentId: { type: "string" },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*",
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      // One per template (same co-location pattern as BlogSite/SiteLayout/LmsFunnel).
      primary: {
        pk: {
          field: "pk",
          composite: ["templateId"],
          template: "TEMPLATE#${templateId}",
        },
        sk: { field: "sk", composite: [], template: "DEPLOYEDAPP" },
      },
    },
  },
  { table, client: docClient },
);

// The backend of a React app (docs/plexo-projects/ARCHITECTURE.md §5–8): its Postgres
// databases, secrets, sign-in settings, storage buckets, server functions and preview
// runtime errors. Keyed under the app's own TEMPLATE#<id> partition (co-located with the
// project), except where a hot path looks a row up by something else.

export type AppEnv = "dev" | "live";

/** One Postgres database of an app: "dev" backs previews, "live" the published app. */
export const AppDatabase = new Entity(
  {
    model: { entity: "appDatabase", version: "1", service: "plexoApps" },
    attributes: {
      templateId: { type: "string", required: true },
      env: { type: ["dev", "live"] as const, required: true },
      organizationId: { type: "string", required: true },
      // Which Aurora cluster holds it — recorded per database so apps can be spread across
      // clusters later without moving anything that already exists.
      clusterId: { type: "string", required: true },
      database: { type: "string", required: true },
      status: { type: ["PROVISIONING", "READY", "FAILED"] as const, required: true },
      statusMessage: { type: "string" },
      // Bumped after every migration, so cached schema introspection is never stale.
      schemaVersion: { type: "number", default: 1 },
      lastMigrationAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["env"], template: "APPDB#${env}" },
      },
    },
  },
  { table, client: docClient },
);

/** A secret (third-party API key etc.) for an app's server functions. The value is
 * KMS-encrypted and never returned to the dashboard after it's saved. */
export const AppSecret = new Entity(
  {
    model: { entity: "appSecret", version: "1", service: "plexoApps" },
    attributes: {
      templateId: { type: "string", required: true },
      name: { type: "string", required: true },
      // "all" (same value for preview and live), or a per-environment override.
      scope: { type: ["all", "dev", "live"] as const, required: true },
      ciphertext: { type: "string", required: true },
      // Last 4 characters, for "sk_live_…a9F2"-style recognition in the dashboard.
      hint: { type: "string" },
      updatedBy: { type: "string" },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["scope", "name"], template: "APPSECRET#${scope}#${name}", casing: "none" },
      },
    },
  },
  { table, client: docClient },
);

/** Per-app settings for the app's own visitor sign-in, plus the keys only Plexo holds. */
export const AppSettings = new Entity(
  {
    model: { entity: "appSettings", version: "1", service: "plexoApps" },
    attributes: {
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      // Sign-in methods visitors can use.
      authPassword: { type: "boolean", default: true },
      authMagicLink: { type: "boolean", default: true },
      authGoogle: { type: "boolean", default: false },
      googleClientId: { type: "string" },
      googleClientSecretCiphertext: { type: "string" },
      // When on, a new account must confirm its email before it can sign in.
      requireEmailConfirmation: { type: "boolean", default: false },
      // Self sign-up on/off (off = invite-only apps, e.g. internal tools).
      allowSignups: { type: "boolean", default: true },
      // Paths that are allowed as post-sign-in redirects besides the app's own origin.
      extraRedirectOrigins: { type: "list", items: { type: "string" } },
      emailFromName: { type: "string" },
      // Service keys let the app's server functions call its own backend with full access.
      // Stored as SHA-256 hashes; the plaintext lives only in the function's environment.
      serviceKeyHashDev: { type: "string" },
      serviceKeyHashLive: { type: "string" },
      // Bucket configuration: { [bucket]: { access: "public" | "private" | "user-folders", maxBytes } }
      buckets: { type: "any" },
      // Per-app request quota (requests/minute across the runtime API), raisable per plan.
      requestsPerMinute: { type: "number" },
      // Search & sharing (lib/projects/appSeo.ts): title, description, sharing image, icon,
      // search-console verification codes — written into every page as it's served.
      seo: { type: "any" },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: [], template: "APPSETTINGS" },
      },
    },
  },
  { table, client: docClient },
);

/** A deployed server function (one Lambda per function per environment). */
export const AppFunction = new Entity(
  {
    model: { entity: "appFunction", version: "1", service: "plexoApps" },
    attributes: {
      templateId: { type: "string", required: true },
      env: { type: ["dev", "live"] as const, required: true },
      name: { type: "string", required: true },
      lambdaName: { type: "string", required: true },
      codeSha256: { type: "string" },
      schedule: { type: "string" },
      scheduleName: { type: "string" },
      buildId: { type: "string" },
      status: { type: ["DEPLOYING", "READY", "FAILED"] as const, required: true },
      statusMessage: { type: "string" },
      deployedAt: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["env", "name"], template: "APPFN#${env}#${name}" },
      },
    },
  },
  { table, client: docClient },
);

/** Errors reported by a preview of the app (lib/projects/previewRuntime.ts), kept for a
 * day so SOL can read them even when no editor is open. On the ops table: it's the one
 * with DynamoDB TTL ("ttl"), so these expire on their own. */
export const AppRuntimeError = new Entity(
  {
    model: { entity: "appRuntimeError", version: "1", service: "plexoApps" },
    attributes: {
      templateId: { type: "string", required: true },
      id: { type: "string", required: true },
      kind: { type: "string", required: true },
      message: { type: "string", required: true },
      stack: { type: "string" },
      url: { type: "string" },
      buildId: { type: "string" },
      count: { type: "number", default: 1 },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      ttl: { type: "number", default: () => Math.floor(Date.now() / 1000) + 24 * 60 * 60 },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "APPERR#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "APPERR#${createdAt}#${id}" },
      },
    },
  },
  { table: TABLES.ops, client: docClient },
);

export const plexoAppsService = new Service(
  { AppDatabase, AppSecret, AppSettings, AppFunction },
  { table, client: docClient },
);
