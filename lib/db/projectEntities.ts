import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-projects — full-stack React apps (Template.sourceType "REACT_PROJECT"). See
// docs/plexo-projects/ARCHITECTURE.md for the whole picture.
//
// File CONTENT never lives in DynamoDB: every file body is stored once in S3 under its
// sha256 (lib/projects/blobStore.ts), and these rows only point at it. That keeps every item
// far below DynamoDB's 400 KB limit no matter how large a project grows, makes a version a
// cheap manifest instead of a full copy, and stores a file that's identical across hundreds
// of versions exactly once.
//
// Lives on the existing plexo-content table (no new table to provision), under its own
// ElectroDB service like customContentEntities.ts does for the same reason.

const table = TABLES.content;

export type ProjectFileEntry = { path: string; sha: string; size: number; contentType: string };

/** The project's working copy: one row per file, keyed by path so a path is unique per
 * project for free. Listing a project's files is one Query on the template's own
 * partition with an sk prefix. */
export const ProjectFile = new Entity(
  {
    model: { entity: "projectFile", version: "1", service: "plexoProjects" },
    attributes: {
      templateId: { type: "string", required: true },
      path: { type: "string", required: true },
      sha: { type: "string", required: true },
      size: { type: "number", required: true },
      contentType: { type: "string", required: true },
      updatedBy: { type: "string" },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        // casing "none": ElectroDB lowercases keys by default, which would make
        // "Button.tsx" and "button.tsx" the same file (and a case-only rename delete it).
        sk: { field: "sk", composite: ["path"], template: "PFILE#${path}", casing: "none" },
      },
    },
  },
  { table, client: docClient },
);

/** An immutable snapshot of the working copy. The manifest itself (path → sha) is stored in
 * S3 (blobStore.versionManifestKey) — a large project's manifest can outgrow a DynamoDB
 * item, and nothing ever needs to query inside it. */
export const ProjectVersion = new Entity(
  {
    model: { entity: "projectVersion", version: "1", service: "plexoProjects" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      message: { type: "string", required: true },
      fileCount: { type: "number", required: true },
      totalBytes: { type: "number", required: true },
      // "ai" (SOL/MCP), "editor" (Code Mode), "deploy" (Deploy API), "restore", "scaffold",
      // "git" (imported from a GitHub push).
      source: { type: "string", required: true },
      // The GitHub commit this version is (pushed as, or imported from) — set once synced.
      commitSha: { type: "string" },
      authorId: { type: "string" },
      authorName: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "PVERSION#${createdAt}#${id}" },
      },
      byId: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["id"], template: "PVERSION#${id}" },
        sk: { field: "GSI1SK", composite: [], template: "PVERSION" },
      },
    },
  },
  { table, client: docClient },
);

export type ProjectBuildStatus = "QUEUED" | "BUILDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type ProjectBuildError = {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  // "build" (Vite/Rollup — blocks the build), "type" (tsc — reported, not blocking),
  // "install" (a package that couldn't be installed), "runtime" (reported by the preview).
  kind: "build" | "type" | "install" | "runtime";
  snippet?: string;
};

/** One build of one version. Get-by-id is the hot path (status polling from SOL, the
 * editor, and the Deploy API), so the build id is its own partition; listing a project's
 * builds newest-first goes through GSI1. */
export const ProjectBuild = new Entity(
  {
    model: { entity: "projectBuild", version: "1", service: "plexoProjects" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      versionId: { type: "string", required: true },
      status: { type: ["QUEUED", "BUILDING", "SUCCEEDED", "FAILED", "CANCELLED"] as const, required: true },
      // "preview" (editor instrumentation on) or "release" (what gets published).
      mode: { type: ["preview", "release"] as const, default: "preview" },
      // Where the built site lives: s3 key prefix under the user-content bucket.
      outputPrefix: { type: "string", required: true },
      errors: { type: "any" },
      warnings: { type: "any" },
      // Short human summary for the UI ("Built in 4.2s", "2 errors in src/App.tsx").
      summary: { type: "string" },
      // Function bundles this build produced (functions/*.ts) — name → s3 key.
      functionBundles: { type: "any" },
      requestedBy: { type: "string" },
      // After a successful build: migrations + function deploys (and, for a release, the
      // live switch + domain) run exactly once, claimed via postStatus (lib/projects/
      // pipeline.ts finalizeBuild), whoever checks on the build first.
      postStatus: { type: ["PENDING", "RUNNING", "DONE"] as const },
      postClaimedAt: { type: "string" },
      migrationResult: { type: "any" },
      functionResult: { type: "any" },
      // Release builds: the subdomain asked for at publish time, and the outcome.
      publishSubdomain: { type: "string" },
      publishResult: { type: "any" },
      startedAt: { type: "string" },
      finishedAt: { type: "string" },
      durationMs: { type: "number" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["id"], template: "PBUILD#${id}" },
        sk: { field: "sk", composite: [], template: "PBUILD" },
      },
      byTemplate: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["templateId"], template: "PBUILDS#${templateId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "PBUILD#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

/** Shareable preview address: "<host>.<pagesDomain>" → the project's latest successful
 * build, published or not. Resolved by middleware's tenant path exactly like a
 * PublishedDomain, so a preview behaves like the real site (own origin, own cookies). */
export const ProjectPreviewHost = new Entity(
  {
    model: { entity: "projectPreviewHost", version: "1", service: "plexoProjects" },
    attributes: {
      host: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["host"], template: "PREVIEWHOST#${host}" },
        sk: { field: "sk", composite: [], template: "PREVIEWHOST" },
      },
    },
  },
  { table, client: docClient },
);

/** A project's link to a GitHub repository (docs/plexo-projects/ARCHITECTURE.md §11). One
 * per project; looked up by repo too, since an inbound push webhook only names the repo. */
export const ProjectGitLink = new Entity(
  {
    model: { entity: "projectGitLink", version: "1", service: "plexoProjects" },
    attributes: {
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      installationId: { type: "number", required: true },
      // "owner/name", lowercased — GitHub names are case-insensitive.
      repoFullName: { type: "string", required: true },
      repoId: { type: "number", required: true },
      branch: { type: "string", required: true },
      lastSyncedCommitSha: { type: "string" },
      // When the app and GitHub were last brought in step (shown as "Last synced").
      lastSyncedAt: { type: "string" },
      lastSyncedVersionId: { type: "string" },
      // OK, CONFLICT (an open plexo/* pull request needs merging), ERROR (app uninstalled,
      // repo gone, branch protected) — shown on the project's GitHub panel.
      status: { type: ["OK", "CONFLICT", "ERROR"] as const, default: "OK" },
      statusMessage: { type: "string" },
      conflictPullRequestUrl: { type: "string" },
      linkedBy: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: [], template: "PGITLINK" },
      },
      byRepo: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["repoId"], template: "GHREPO#${repoId}" },
        sk: { field: "GSI1SK", composite: ["templateId"], template: "PGITLINK#${templateId}" },
      },
    },
  },
  { table, client: docClient },
);

/** A GitHub App installation an organization has proven access to (verified through the
 * installing person's own GitHub authorization, not just the installation id GitHub's
 * redirect carries — that id alone could be forged to reach someone else's repositories). */
export const GitHubInstallation = new Entity(
  {
    model: { entity: "githubInstallation", version: "1", service: "plexoProjects" },
    attributes: {
      organizationId: { type: "string", required: true },
      installationId: { type: "number", required: true },
      accountLogin: { type: "string", required: true },
      accountType: { type: "string" },
      verifiedBy: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "sk", composite: ["installationId"], template: "GHINSTALL#${installationId}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoProjectsService = new Service(
  { ProjectFile, ProjectVersion, ProjectBuild, ProjectPreviewHost, ProjectGitLink, GitHubInstallation },
  { table, client: docClient },
);
