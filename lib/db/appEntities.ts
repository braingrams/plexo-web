import { Entity } from "electrodb";
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
