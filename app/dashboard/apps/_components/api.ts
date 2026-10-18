"use client";

// Client for the app editor: thin, typed wrappers over /api/v1/apps/* (see those routes for
// the full contract). Every call throws ApiError with the server's plain-language message.

import type { DesignSystem, PageDefinition } from "@charisol/plexo-sdk/v2/compile";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly hint?: string, public readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.hint, data ?? undefined);
  }
  return data as T;
}

export type AppEnv = "dev" | "live";

export type AppSummary = {
  id: string;
  name: string;
  previewUrl: string | null;
  liveUrl: string | null;
  published: boolean;
  domains: Array<{ domain: string; type: string; verified: boolean }>;
  headVersionId: string | null;
  latestBuild: { id: string; versionId: string; finishedAt: string | null; summary: string | null } | null;
  liveBuild: { id: string; versionId: string; finishedAt: string | null } | null;
  databases: Array<{ env: AppEnv; status: string; lastMigrationAt: string | null }>;
};

export type BuildError = { kind: string; file?: string; line?: number; column?: number; message: string; snippet?: string };

export type BuildReport = {
  ok: boolean;
  buildId: string;
  versionId: string;
  mode: "preview" | "release";
  status: "QUEUED" | "BUILDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  pending: boolean;
  summary: string;
  errors: BuildError[];
  typeProblems: BuildError[];
  warnings: BuildError[];
  migrations: { applied: string[]; skipped: string[]; edited: string[]; failed?: { name: string; message: string; line?: number; hint?: string } } | null;
  functions: { deployed: string[]; removed: string[]; failed: Array<{ name: string; message: string }> } | null;
  previewUrl: string | null;
  liveUrl: string | null;
  domains: string[];
  durationMs: number | null;
  log?: string;
};

export type FileEntry = { path: string; size: number; contentType: string; sha: string };

export type DesignSummary = { slug: string; name: string; route: string; file: string; codeFile: string; codeEdited: boolean; updatedAt: string };
// `page` is the editor's PageDefinition; `designSystem` is sent only when it changed.
export type DesignSave = { name: string; route: string; page: PageDefinition; designSystem?: DesignSystem | null };
export type DesignSaveResult = { design: DesignSummary; routesWired: boolean; recompiled: string[]; skipped: string[]; warnings: string[] };

export const appsApi = {
  summary: (id: string) => api<AppSummary>(`/api/v1/apps/${id}`),
  rename: (id: string, name: string) => api<AppSummary>(`/api/v1/apps/${id}`, { method: "PATCH", json: { name } }),
  files: (id: string) => api<{ files: FileEntry[] }>(`/api/v1/apps/${id}/files`),
  readFiles: (id: string, paths: string[]) =>
    api<{ files: Array<{ path: string; content?: string; base64?: string; size: number; contentType: string }>; missing: string[] }>(
      `/api/v1/apps/${id}/files?paths=${encodeURIComponent(paths.join(","))}`,
    ),
  writeFiles: (id: string, files: Array<{ path: string; content?: string; base64?: string }>) => api(`/api/v1/apps/${id}/files`, { method: "PUT", json: { files } }),
  deleteFiles: (id: string, paths: string[]) => api(`/api/v1/apps/${id}/files`, { method: "DELETE", json: { paths } }),
  renameFile: (id: string, from: string, to: string) => api(`/api/v1/apps/${id}/files/rename`, { method: "POST", json: { from, to } }),
  build: (id: string, message?: string) => api<{ buildId: string; versionId: string }>(`/api/v1/apps/${id}/builds`, { method: "POST", json: { message } }),
  builds: (id: string) => api<{ builds: Array<{ id: string; versionId: string; mode: string; status: string; summary: string | null; createdAt: string; finishedAt: string | null; durationMs: number | null }> }>(`/api/v1/apps/${id}/builds`),
  buildReport: (id: string, buildId: string, log = false) => api<BuildReport>(`/api/v1/apps/${id}/builds/${buildId}${log ? "?log=1" : ""}`),
  publish: (id: string, subdomain?: string) => api<{ buildId: string }>(`/api/v1/apps/${id}/publish`, { method: "POST", json: { subdomain } }),
  versions: (id: string) => api<{ versions: Array<{ id: string; message: string; source: string; authorName: string | null; fileCount: number; commitSha: string | null; createdAt: string; isLive: boolean }> }>(`/api/v1/apps/${id}/versions`),
  saveVersion: (id: string, message?: string) => api<{ versionId: string; changed: boolean }>(`/api/v1/apps/${id}/versions`, { method: "POST", json: { message } }),
  restore: (id: string, versionId: string) => api<{ versionId: string; buildId: string | null }>(`/api/v1/apps/${id}/versions/${versionId}/restore`, { method: "POST" }),
  diff: (id: string, versionId: string, against = "working", path?: string) =>
    api<{ diff: { added: string[]; removed: string[]; changed: string[] }; path?: string; before?: { content?: string; binary?: boolean } | null; after?: { content?: string; binary?: boolean } | null }>(
      `/api/v1/apps/${id}/versions/${versionId}/diff?against=${encodeURIComponent(against)}${path ? `&path=${encodeURIComponent(path)}` : ""}`,
    ),
  runtimeErrors: (id: string, minutes = 30) => api<{ errors: Array<{ kind: string; message: string; stack: string | null; url: string | null; lastAt: string; count: number }> }>(`/api/v1/apps/${id}/runtime-errors?minutes=${minutes}`),
  designs: (id: string) => api<{ designs: DesignSummary[]; designSystem: DesignSystem }>(`/api/v1/apps/${id}/designs`),
  design: (id: string, slug: string) => api<{ design: DesignSummary; page: PageDefinition; designSystem: DesignSystem }>(`/api/v1/apps/${id}/designs/${slug}`),
  createDesign: (id: string, body: DesignSave) => api<DesignSaveResult>(`/api/v1/apps/${id}/designs`, { method: "POST", json: body }),
  saveDesign: (id: string, slug: string, body: DesignSave & { overwrite?: boolean }) => api<DesignSaveResult>(`/api/v1/apps/${id}/designs/${slug}`, { method: "PUT", json: body }),
  deleteDesign: (id: string, slug: string) => api(`/api/v1/apps/${id}/designs/${slug}`, { method: "DELETE" }),
  conversation: (id: string) => api<{ conversationId: string; modelTier: "BASIC" | "MEDIUM" | "HIGH" }>(`/api/v1/apps/${id}/conversation`, { method: "POST" }),
};

/** "Keep my website up to date with Strata" for one app (the server holds the key; none ever reaches the browser). */
export type StrataAutoUpdateState = {
  available?: boolean;
  enabled: boolean;
  status: "active" | "needs-reconnect" | "off";
  lastCheckedAt: string | null;
  /** Plain language, ready to show. */
  lastResult: string | null;
  lastResultKind: "updated" | "up-to-date" | "needs-review" | "error" | "reconnect" | null;
};
export const strataAutoUpdateApi = {
  get: (id: string) => api<StrataAutoUpdateState>(`/api/v1/apps/${id}/strata-auto-update`),
  enable: (id: string) => api<StrataAutoUpdateState>(`/api/v1/apps/${id}/strata-auto-update`, { method: "POST" }),
  disable: (id: string) => api<StrataAutoUpdateState>(`/api/v1/apps/${id}/strata-auto-update`, { method: "DELETE" }),
};

/** Polls a build until it (and its post-build steps) finish. */
export async function pollBuild(appId: string, buildId: string, onUpdate?: (r: BuildReport) => void, signal?: AbortSignal): Promise<BuildReport> {
  let delay = 900;
  for (;;) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const report = await appsApi.buildReport(appId, buildId);
    onUpdate?.(report);
    if (!report.pending) return report;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 3000);
  }
}
