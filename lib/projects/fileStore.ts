import { randomUUID } from "node:crypto";
import { ProjectFile, ProjectVersion, type ProjectFileEntry } from "@/lib/db/projectEntities";
import { Template } from "@/lib/db/contentEntities";
import { putBlob, getBlob, putJson, getJson, versionManifestKey } from "./blobStore";
import { normalizeProjectPath, contentTypeForPath, isTextContentType, PROJECT_LIMITS, ProjectPathError } from "./paths";
import { mapLimit, chunk } from "./concurrency";

// A project's working copy and its version history. Every surface that changes files —
// SOL/MCP tools, the dashboard editor, the Deploy API — goes through here, so limits and
// path rules are enforced in exactly one place.

export class ProjectFileError extends Error {}

export type FileWrite = {
  path: string;
  /** UTF-8 text content. Exactly one of content / base64 is set. */
  content?: string;
  /** Binary content (images, fonts), base64-encoded. */
  base64?: string;
};

export type FileEdit = { find: string; replace: string; all?: boolean };

export type VersionManifest = { versionId: string; files: ProjectFileEntry[] };

export async function listFiles(templateId: string): Promise<ProjectFileEntry[]> {
  const { data } = await ProjectFile.query.primary({ templateId }).go({ pages: "all" });
  return data
    .map((row) => ({ path: row.path, sha: row.sha, size: row.size, contentType: row.contentType }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export type ReadFileResult = { path: string; content?: string; base64?: string; size: number; contentType: string };

export async function readFiles(templateId: string, rawPaths: string[]): Promise<{ files: ReadFileResult[]; missing: string[] }> {
  const paths = rawPaths.map(normalizeProjectPath);
  const rows = await mapLimit(paths, 16, async (path) => (await ProjectFile.get({ templateId, path }).go()).data);
  const missing: string[] = [];
  const found = rows.flatMap((row, i) => {
    if (!row) {
      missing.push(paths[i]);
      return [];
    }
    return [row];
  });
  const files = await mapLimit(found, 16, async (row) => {
    const body = await getBlob(templateId, row.sha);
    return isTextContentType(row.contentType)
      ? { path: row.path, content: body.toString("utf8"), size: row.size, contentType: row.contentType }
      : { path: row.path, base64: body.toString("base64"), size: row.size, contentType: row.contentType };
  });
  return { files, missing };
}

export async function readTextFile(templateId: string, path: string): Promise<string | null> {
  const { files } = await readFiles(templateId, [path]);
  return files[0]?.content ?? null;
}

function bodyOf(write: FileWrite): Buffer {
  if (typeof write.content === "string" && typeof write.base64 === "string") {
    throw new ProjectFileError(`${write.path}: send either content or base64, not both.`);
  }
  if (typeof write.base64 === "string") return Buffer.from(write.base64, "base64");
  if (typeof write.content === "string") return Buffer.from(write.content, "utf8");
  throw new ProjectFileError(`${write.path}: no content was given.`);
}

/** Creates or overwrites files. All paths are validated and every limit checked before
 * anything is stored, so a rejected call never leaves half its files written. */
export async function writeFiles(templateId: string, writes: FileWrite[], updatedBy?: string): Promise<ProjectFileEntry[]> {
  if (!Array.isArray(writes) || writes.length === 0) throw new ProjectFileError("No files were given to save.");
  if (writes.length > PROJECT_LIMITS.maxFilesPerWrite) {
    throw new ProjectFileError(`Save at most ${PROJECT_LIMITS.maxFilesPerWrite} files at once (got ${writes.length}). Split the change into smaller saves.`);
  }

  const prepared = new Map<string, { body: Buffer; contentType: string }>();
  for (const write of writes) {
    let path: string;
    try {
      path = normalizeProjectPath(write.path);
    } catch (err) {
      if (err instanceof ProjectPathError) throw new ProjectFileError(err.message);
      throw err;
    }
    const body = bodyOf({ ...write, path });
    if (body.length > PROJECT_LIMITS.maxFileBytes) {
      throw new ProjectFileError(`${path} is ${(body.length / 1024 / 1024).toFixed(1)} MB — files can be at most ${PROJECT_LIMITS.maxFileBytes / 1024 / 1024} MB. Large media belongs in uploaded media, referenced by URL.`);
    }
    prepared.set(path, { body, contentType: contentTypeForPath(path) });
  }

  const existing = await listFiles(templateId);
  const existingByPath = new Map(existing.map((f) => [f.path, f]));
  const newCount = [...prepared.keys()].filter((p) => !existingByPath.has(p)).length;
  if (existing.length + newCount > PROJECT_LIMITS.maxFiles) {
    throw new ProjectFileError(`A project can have at most ${PROJECT_LIMITS.maxFiles} files; this save would make ${existing.length + newCount}.`);
  }
  let total = existing.reduce((sum, f) => sum + f.size, 0);
  for (const [path, { body }] of prepared) total += body.length - (existingByPath.get(path)?.size ?? 0);
  if (total > PROJECT_LIMITS.maxTotalBytes) {
    throw new ProjectFileError(`This save would make the project ${(total / 1024 / 1024).toFixed(0)} MB; the limit is ${PROJECT_LIMITS.maxTotalBytes / 1024 / 1024} MB.`);
  }

  const entries = await mapLimit([...prepared.entries()], 16, async ([path, { body, contentType }]) => {
    const sha = await putBlob(templateId, body, contentType);
    return { path, sha, size: body.length, contentType };
  });
  const changed = entries.filter((e) => existingByPath.get(e.path)?.sha !== e.sha);
  for (const batch of chunk(changed, 25)) {
    await ProjectFile.put(batch.map((e) => ({ templateId, ...e, updatedBy }))).go();
  }
  return entries;
}

/** Targeted edits: each `find` must match exactly once (or `all: true`), so an AI can change
 * three lines of a 600-line file without resending it — faster, cheaper, and it can't
 * accidentally drop the rest of the file. */
export async function editFile(templateId: string, rawPath: string, edits: FileEdit[], updatedBy?: string): Promise<ProjectFileEntry> {
  const path = normalizeProjectPath(rawPath);
  const current = await readTextFile(templateId, path);
  if (current === null) throw new ProjectFileError(`${path} doesn't exist. Create it with a full write instead of an edit.`);
  if (!Array.isArray(edits) || edits.length === 0) throw new ProjectFileError("No edits were given.");
  const next = applyEdits(current, edits, path);
  const [entry] = await writeFiles(templateId, [{ path, content: next }], updatedBy);
  return entry;
}

/** Applies find/replace edits to a file's text, in order. A `find` that matches exactly is
 * used as is; failing that, one that matches line for line apart from indentation and
 * trailing spaces (the usual reason an edit misses) is used if it's unique. If it still isn't
 * there, the error carries the closest part of the current file, with line numbers, so the
 * next attempt can copy the real text instead of spending a round re-reading the file. */
export function applyEdits(current: string, edits: FileEdit[], path: string): string {
  let next = current;
  edits.forEach((edit, i) => {
    if (typeof edit?.find !== "string" || edit.find === "") throw new ProjectFileError(`Edit ${i + 1} on ${path} has no text to find.`);
    if (typeof edit.replace !== "string") throw new ProjectFileError(`Edit ${i + 1} on ${path} has no replacement text.`);
    const count = next.split(edit.find).length - 1;
    if (count > 1 && !edit.all) {
      throw new ProjectFileError(`Edit ${i + 1} on ${path}: the text to find appears ${count} times. Include more surrounding lines so it matches once, or set all: true to replace every one.`);
    }
    if (count >= 1) {
      next = edit.all ? next.split(edit.find).join(edit.replace) : next.replace(edit.find, () => edit.replace);
      return;
    }
    const loose = looseMatches(next, edit.find);
    if (loose.length === 1) {
      const [start, end] = loose[0];
      next = next.slice(0, start) + edit.replace + next.slice(end);
      return;
    }
    if (loose.length > 1 && !edit.all) {
      throw new ProjectFileError(`Edit ${i + 1} on ${path}: the text to find appears ${loose.length} times (ignoring indentation). Include more surrounding lines so it matches once.`);
    }
    if (loose.length > 1) {
      for (const [start, end] of loose.reverse()) next = next.slice(0, start) + edit.replace + next.slice(end);
      return;
    }
    throw new ProjectFileError(`Edit ${i + 1} on ${path}: the text to find isn't in the file. ${closestRegion(next, edit.find)}`);
  });
  return next;
}

const norm = (line: string) => line.trim().replace(/\s+/g, " ");

/** [start, end) character ranges of the file whose lines equal `find`'s lines once each line
 *  is trimmed and its inner whitespace collapsed (blank lines at either end of `find` ignored). */
function looseMatches(text: string, find: string): Array<[number, number]> {
  const want = find.split("\n").map(norm);
  while (want.length && want[0] === "") want.shift();
  while (want.length && want[want.length - 1] === "") want.pop();
  if (!want.length) return [];
  const lines = text.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i + want.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length && ok; j++) ok = norm(lines[i + j]) === want[j];
    if (ok) {
      const last = i + want.length - 1;
      out.push([starts[i], starts[last] + lines[last].length]);
      i = last;
    }
  }
  return out;
}

/** The part of the file most like `find`, numbered, for the error message. */
function closestRegion(text: string, find: string): string {
  const lines = text.split("\n");
  const probes = find.split("\n").map(norm).filter((l) => l.length > 3);
  if (!probes.length) return "Read the file again and copy the exact lines.";
  // Word overlap, so a line that differs by a word or two still counts as close.
  const words = (l: string) => new Set(l.toLowerCase().split(/[^a-z0-9_$]+/).filter(Boolean));
  const probeWords = probes.map(words);
  let best = -1;
  let bestScore = 0;
  lines.forEach((line, i) => {
    const lw = words(line);
    if (!lw.size) return;
    const score = Math.max(...probeWords.map((pw) => [...pw].filter((w) => lw.has(w)).length / Math.max(pw.size, lw.size)));
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  if (best < 0 || bestScore < 0.3) return "Nothing in the file looks like it — read the file again before editing.";
  const from = Math.max(0, best - 6);
  const to = Math.min(lines.length, best + Math.max(probes.length, 1) + 6);
  const width = String(to).length;
  const shown = lines.slice(from, to).map((l, k) => `${String(from + k + 1).padStart(width)}| ${l}`).join("\n");
  return `The closest part of the file right now (lines ${from + 1}–${to}) is:\n${shown}\nCopy the find text exactly from these lines (without the line numbers).`;
}

export async function deleteFiles(templateId: string, rawPaths: string[]): Promise<string[]> {
  const paths = [...new Set(rawPaths.map(normalizeProjectPath))];
  const existing = new Set((await listFiles(templateId)).map((f) => f.path));
  // A folder path deletes everything under it.
  const targets = [...existing].filter((p) => paths.some((d) => p === d || p.startsWith(`${d}/`)));
  for (const batch of chunk(targets, 25)) {
    await ProjectFile.delete(batch.map((path) => ({ templateId, path }))).go();
  }
  return targets;
}

export async function renameFile(templateId: string, rawFrom: string, rawTo: string, updatedBy?: string): Promise<void> {
  const from = normalizeProjectPath(rawFrom);
  const to = normalizeProjectPath(rawTo);
  const { data: row } = await ProjectFile.get({ templateId, path: from }).go();
  if (!row) throw new ProjectFileError(`${from} doesn't exist.`);
  const { data: clash } = await ProjectFile.get({ templateId, path: to }).go();
  if (clash) throw new ProjectFileError(`${to} already exists — delete it first or pick another name.`);
  // The body is content-addressed, so a rename never copies bytes.
  await ProjectFile.put({ templateId, path: to, sha: row.sha, size: row.size, contentType: contentTypeForPath(to), updatedBy }).go();
  await ProjectFile.delete({ templateId, path: from }).go();
}

// ---------------------------------------------------------------- versions

export type VersionSource = "ai" | "editor" | "deploy" | "restore" | "scaffold" | "git";

export async function snapshotVersion(
  templateId: string,
  input: { message: string; source: VersionSource; authorId?: string; authorName?: string; commitSha?: string; skipGitPush?: boolean },
): Promise<{ versionId: string; files: ProjectFileEntry[] }> {
  const files = await listFiles(templateId);
  if (files.length === 0) throw new ProjectFileError("This project has no files yet.");
  const versionId = randomUUID();
  await putJson(versionManifestKey(templateId, versionId), { versionId, files } satisfies VersionManifest);
  await ProjectVersion.create({
    id: versionId,
    templateId,
    message: (input.message || "Update").slice(0, 300),
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    source: input.source,
    authorId: input.authorId,
    authorName: input.authorName,
    commitSha: input.commitSha,
  }).go();
  await Template.patch({ id: templateId }).set({ headVersionId: versionId }).go();
  // Linked to GitHub: every version becomes a commit (a no-op without a link). Imported from
  // GitHub (source "git") versions are already there. Loaded lazily — sync imports this module.
  if (!input.skipGitPush && input.source !== "git") {
    const { pushVersion } = await import("./github/sync");
    await pushVersion(templateId, versionId);
  }
  return { versionId, files };
}

export async function getVersionManifest(templateId: string, versionId: string): Promise<VersionManifest> {
  const manifest = await getJson<VersionManifest>(versionManifestKey(templateId, versionId));
  if (!manifest) throw new ProjectFileError("That version no longer exists.");
  return manifest;
}

export async function listVersions(templateId: string, limit = 50) {
  const { data } = await ProjectVersion.query.primary({ templateId }).go({ order: "desc", limit });
  return data;
}

/** Puts a past version back as the working copy (files added since are removed), then
 * records the restore as its own new version so the history stays linear and undoable. */
export async function restoreVersion(templateId: string, versionId: string, author: { authorId?: string; authorName?: string }) {
  const manifest = await getVersionManifest(templateId, versionId);
  const current = await listFiles(templateId);
  const keep = new Set(manifest.files.map((f) => f.path));
  const toDelete = current.filter((f) => !keep.has(f.path)).map((f) => f.path);
  for (const batch of chunk(toDelete, 25)) await ProjectFile.delete(batch.map((path) => ({ templateId, path }))).go();
  for (const batch of chunk(manifest.files, 25)) {
    await ProjectFile.put(batch.map((f) => ({ templateId, ...f, updatedBy: author.authorId }))).go();
  }
  const { data: version } = await ProjectVersion.query.byId({ id: versionId }).go({ pages: "all" });
  const label = version[0]?.createdAt ? new Date(version[0].createdAt).toISOString().slice(0, 16).replace("T", " ") : versionId.slice(0, 8);
  return snapshotVersion(templateId, { message: `Restored version from ${label}`, source: "restore", ...author });
}

export type FileDiff = { added: string[]; removed: string[]; changed: string[] };

export function diffManifests(before: ProjectFileEntry[], after: ProjectFileEntry[]): FileDiff {
  const a = new Map(before.map((f) => [f.path, f.sha]));
  const b = new Map(after.map((f) => [f.path, f.sha]));
  return {
    added: [...b.keys()].filter((p) => !a.has(p)),
    removed: [...a.keys()].filter((p) => !b.has(p)),
    changed: [...b.keys()].filter((p) => a.has(p) && a.get(p) !== b.get(p)),
  };
}
