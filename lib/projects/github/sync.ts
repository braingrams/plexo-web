import { ProjectGitLink, ProjectVersion } from "@/lib/db/projectEntities";
import { getBlob } from "../blobStore";
import { getVersionManifest, listFiles, writeFiles, deleteFiles, snapshotVersion, diffManifests, type FileWrite } from "../fileStore";
import { contentTypeForPath, isTextContentType, normalizeProjectPath, PROJECT_LIMITS } from "../paths";
import { chunk, mapLimit } from "../concurrency";
import { gh, GitHubError } from "./client";
import type { ProjectFileEntry } from "@/lib/db/projectEntities";

// Two-way GitHub sync for an app (docs/plexo-projects/ARCHITECTURE.md §11).
//
//   Plexo → GitHub: each version is one commit on the linked branch, built with the Git Data
//   API from only the files that changed. Never a force-push: if GitHub moved on and the same
//   file changed on both sides, the version goes to a plexo/<version> branch with a pull
//   request instead.
//   GitHub → Plexo: a push webhook imports the changed files as a new version (source "git")
//   and rebuilds the preview. Plexo's own commits are recognized by sha and skipped.

type Link = NonNullable<Awaited<ReturnType<typeof getLink>>>;

export async function getLink(templateId: string) {
  const { data } = await ProjectGitLink.get({ templateId }).go();
  return data;
}

const SKIP = /^(node_modules|dist|\.git)\//;
const repoPath = (link: { repoFullName: string }) => `/repos/${link.repoFullName}`;

async function remoteHead(link: Pick<Link, "installationId" | "repoFullName" | "branch">): Promise<string | null> {
  const ref = await gh<{ object: { sha: string } } | null>(link.installationId, `${repoPath(link)}/git/ref/heads/${encodeURIComponent(link.branch)}`, { allow404: true });
  return ref?.object.sha ?? null;
}

async function createCommit(
  link: Pick<Link, "installationId" | "repoFullName">,
  input: { templateId: string; files: ProjectFileEntry[]; deleted: string[]; parent: string | null; baseTree: string | null; message: string },
): Promise<string> {
  const entries = await mapLimit(input.files, 8, async (f) => {
    const body = await getBlob(input.templateId, f.sha);
    const blob = await gh<{ sha: string }>(link.installationId, `${repoPath(link)}/git/blobs`, { method: "POST", body: { content: body.toString("base64"), encoding: "base64" } });
    return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
  });
  const tree = await gh<{ sha: string }>(link.installationId, `${repoPath(link)}/git/trees`, {
    method: "POST",
    body: { ...(input.baseTree ? { base_tree: input.baseTree } : {}), tree: [...entries, ...input.deleted.map((path) => ({ path, mode: "100644", type: "blob", sha: null }))] },
  });
  const commit = await gh<{ sha: string }>(link.installationId, `${repoPath(link)}/git/commits`, {
    method: "POST",
    body: { message: input.message, tree: tree.sha, parents: input.parent ? [input.parent] : [] },
  });
  return commit.sha;
}

async function setRef(link: Pick<Link, "installationId" | "repoFullName">, branch: string, sha: string, exists: boolean) {
  if (exists) await gh(link.installationId, `${repoPath(link)}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: { sha, force: false } });
  else await gh(link.installationId, `${repoPath(link)}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha } });
}

async function treeOf(installationId: number, repoFullName: string, commitSha: string): Promise<string> {
  const commit = await gh<{ tree: { sha: string } }>(installationId, `/repos/${repoFullName}/git/commits/${commitSha}`);
  return commit.tree.sha;
}

/** Pushes a version to the linked repo. Safe to call for every version; a no-op without a link. */
export async function pushVersion(templateId: string, versionId: string): Promise<{ commitSha?: string; conflict?: string } | null> {
  const link = await getLink(templateId);
  if (!link) return null;
  try {
    const manifest = await getVersionManifest(templateId, versionId);
    const { data: versionRows } = await ProjectVersion.query.byId({ id: versionId }).go({ pages: "all" });
    const message = `${versionRows[0]?.message ?? "Update"}\n\nPlexo version ${versionId}`;
    const head = await remoteHead(link);

    // What changed in Plexo since the last version GitHub has.
    const base = link.lastSyncedVersionId ? await getVersionManifest(templateId, link.lastSyncedVersionId).catch(() => null) : null;
    const plexoDiff = base ? diffManifests(base.files, manifest.files) : null;
    const changedPaths = plexoDiff ? new Set([...plexoDiff.added, ...plexoDiff.changed]) : null;
    const filesToSend = changedPaths ? manifest.files.filter((f) => changedPaths.has(f.path)) : manifest.files;
    const deleted = plexoDiff ? plexoDiff.removed : [];
    if (plexoDiff && !filesToSend.length && !deleted.length && head === link.lastSyncedCommitSha) return null;

    if (head && link.lastSyncedCommitSha && head !== link.lastSyncedCommitSha && changedPaths) {
      // GitHub moved since the last sync: only safe to stack on top if nobody touched the
      // same files on both sides.
      const compare = await gh<{ files?: Array<{ filename: string; previous_filename?: string }> }>(link.installationId, `${repoPath(link)}/compare/${link.lastSyncedCommitSha}...${head}`);
      const remoteChanged = new Set((compare.files ?? []).flatMap((f) => [f.filename, f.previous_filename].filter(Boolean) as string[]));
      const clash = [...changedPaths, ...deleted].filter((p) => remoteChanged.has(p));
      if (clash.length) {
        const branch = `plexo/${versionId.slice(0, 8)}`;
        const commitSha = await createCommit(link, { templateId, files: filesToSend, deleted, parent: link.lastSyncedCommitSha, baseTree: await treeOf(link.installationId, link.repoFullName, link.lastSyncedCommitSha), message });
        await setRef(link, branch, commitSha, false);
        const pr = await gh<{ html_url: string }>(link.installationId, `${repoPath(link)}/pulls`, {
          method: "POST",
          body: { title: `Plexo changes: ${versionRows[0]?.message ?? "update"}`, head: branch, base: link.branch, body: `These changes were made in Plexo while the same files changed on GitHub (${clash.slice(0, 10).join(", ")}). Review and merge to bring them in — Plexo didn't overwrite anything.` },
        });
        await ProjectGitLink.patch({ templateId }).set({ status: "CONFLICT", statusMessage: `Both sides changed ${clash.slice(0, 3).join(", ")}${clash.length > 3 ? "…" : ""}`, conflictPullRequestUrl: pr.html_url }).go();
        return { conflict: pr.html_url };
      }
    }

    const commitSha = await createCommit(link, {
      templateId,
      // A first push (no earlier sync) writes the whole project as the tree, exactly.
      files: filesToSend,
      deleted,
      parent: head,
      baseTree: head && changedPaths ? await treeOf(link.installationId, link.repoFullName, head) : null,
      message,
    });
    await setRef(link, link.branch, commitSha, !!head);
    await ProjectGitLink.patch({ templateId }).set({ lastSyncedCommitSha: commitSha, lastSyncedVersionId: versionId, status: "OK", statusMessage: "" }).go();
    if (versionRows[0]) await ProjectVersion.patch({ templateId, createdAt: versionRows[0].createdAt!, id: versionId }).set({ commitSha }).go();
    return { commitSha };
  } catch (err) {
    const message = err instanceof GitHubError ? err.message : `Couldn't push to GitHub: ${err instanceof Error ? err.message : String(err)}`;
    await ProjectGitLink.patch({ templateId }).set({ status: "ERROR", statusMessage: message.slice(0, 400) }).go().catch(() => undefined);
    return null;
  }
}

/** Reads a commit's whole file tree into project files (for linking a non-empty repo). */
async function readTree(installationId: number, repoFullName: string, commitSha: string): Promise<FileWrite[]> {
  const tree = await gh<{ tree: Array<{ path: string; type: string; sha: string; size?: number }>; truncated: boolean }>(installationId, `/repos/${repoFullName}/git/trees/${commitSha}?recursive=1`);
  if (tree.truncated) throw new GitHubError("That repository is too large to import.", 413);
  const blobs = tree.tree.filter((t) => t.type === "blob" && !SKIP.test(t.path) && (t.size ?? 0) <= PROJECT_LIMITS.maxFileBytes);
  if (blobs.length > PROJECT_LIMITS.maxFiles) throw new GitHubError(`That repository has more than ${PROJECT_LIMITS.maxFiles} files.`, 413);
  return mapLimit(blobs, 8, async (b) => {
    const blob = await gh<{ content: string }>(installationId, `/repos/${repoFullName}/git/blobs/${b.sha}`);
    const bytes = Buffer.from(blob.content, "base64");
    return isTextContentType(contentTypeForPath(b.path)) ? { path: b.path, content: bytes.toString("utf8") } : { path: b.path, base64: bytes.toString("base64") };
  });
}

/**
 * Links an app to a repo branch. An empty repo (or branch) gets the app pushed to it. A repo
 * that already has code is imported into the app instead (bringing an existing React app
 * into Plexo) — unless `prefer: "plexo"`, which pushes the app on top.
 */
export async function linkRepo(input: {
  templateId: string;
  organizationId: string;
  installationId: number;
  repoFullName: string;
  repoId: number;
  branch: string;
  linkedBy: string;
  prefer?: "plexo" | "github";
}): Promise<{ action: "pushed" | "imported"; versionId?: string }> {
  const link = { installationId: input.installationId, repoFullName: input.repoFullName.toLowerCase(), branch: input.branch };
  const head = await remoteHead(link);
  await ProjectGitLink.put({ templateId: input.templateId, organizationId: input.organizationId, installationId: input.installationId, repoFullName: link.repoFullName, repoId: input.repoId, branch: input.branch, status: "OK", linkedBy: input.linkedBy }).go();

  if (head && input.prefer !== "plexo") {
    const files = await readTree(input.installationId, link.repoFullName, head);
    const current = await listFiles(input.templateId);
    const incoming = new Set(files.map((f) => normalizeProjectPath(f.path)));
    for (const batch of chunk(files, PROJECT_LIMITS.maxFilesPerWrite)) await writeFiles(input.templateId, batch, input.linkedBy);
    const stale = current.map((f) => f.path).filter((p) => !incoming.has(p));
    if (stale.length) await deleteFiles(input.templateId, stale);
    const { versionId } = await snapshotVersion(input.templateId, { message: `Imported from ${link.repoFullName}`, source: "git" });
    await ProjectGitLink.patch({ templateId: input.templateId }).set({ lastSyncedCommitSha: head, lastSyncedVersionId: versionId }).go();
    return { action: "imported", versionId };
  }

  const { versionId } = await snapshotVersion(input.templateId, { message: `Linked to ${link.repoFullName}`, source: "editor", skipGitPush: true });
  if (head) await ProjectGitLink.patch({ templateId: input.templateId }).set({ lastSyncedCommitSha: head }).go();
  await pushVersion(input.templateId, versionId);
  return { action: "pushed", versionId };
}

/** A push to a linked branch (webhook): import what changed into the app. Returns the new
 * version, or null when there's nothing to import (Plexo's own commit, another branch). */
export async function importPush(templateId: string, push: { after: string; ref: string; headMessage: string; author: string }): Promise<{ versionId: string } | null> {
  const link = await getLink(templateId);
  if (!link || push.ref !== `refs/heads/${link.branch}` || push.after === link.lastSyncedCommitSha || /^0+$/.test(push.after)) return null;

  let changed: FileWrite[] = [];
  let removed: string[] = [];
  if (link.lastSyncedCommitSha) {
    const compare = await gh<{ files?: Array<{ filename: string; status: string; sha: string; previous_filename?: string }> }>(link.installationId, `${repoPath(link)}/compare/${link.lastSyncedCommitSha}...${push.after}`);
    const files = (compare.files ?? []).filter((f) => !SKIP.test(f.filename));
    if (files.length >= 300) {
      changed = await readTree(link.installationId, link.repoFullName, push.after); // compare lists at most 300
      const keep = new Set(changed.map((f) => f.path));
      removed = (await listFiles(templateId)).map((f) => f.path).filter((p) => !keep.has(p));
    } else {
      removed = files.filter((f) => f.status === "removed").map((f) => f.filename);
      removed.push(...files.filter((f) => f.status === "renamed" && f.previous_filename).map((f) => f.previous_filename!));
      changed = await mapLimit(files.filter((f) => f.status !== "removed"), 8, async (f) => {
        const blob = await gh<{ content: string }>(link.installationId, `${repoPath(link)}/git/blobs/${f.sha}`);
        const bytes = Buffer.from(blob.content, "base64");
        return isTextContentType(contentTypeForPath(f.filename)) ? { path: f.filename, content: bytes.toString("utf8") } : { path: f.filename, base64: bytes.toString("base64") };
      });
    }
  } else {
    changed = await readTree(link.installationId, link.repoFullName, push.after);
  }

  for (const batch of chunk(changed, PROJECT_LIMITS.maxFilesPerWrite)) await writeFiles(templateId, batch, `github:${push.author}`);
  if (removed.length) await deleteFiles(templateId, removed);
  const { versionId } = await snapshotVersion(templateId, { message: push.headMessage.split("\n")[0].slice(0, 200) || "Pushed from GitHub", source: "git", authorName: push.author, commitSha: push.after, skipGitPush: true });
  await ProjectGitLink.patch({ templateId }).set({ lastSyncedCommitSha: push.after, lastSyncedVersionId: versionId, status: "OK", statusMessage: "" }).go();
  return { versionId };
}

export async function unlinkRepo(templateId: string): Promise<void> {
  await ProjectGitLink.delete({ templateId }).go();
}
