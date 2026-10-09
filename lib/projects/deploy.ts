import JSZip from "jszip";
import { Template } from "@/lib/db/contentEntities";
import { createProject, type ProjectOwner } from "./createProject";
import { listFiles, writeFiles, deleteFiles, type FileWrite } from "./fileStore";
import { startPreview, startPublish } from "./pipeline";
import { previewUrl } from "./previewHost";
import { contentTypeForPath, isTextContentType, PROJECT_LIMITS } from "./paths";
import { chunk } from "./concurrency";
import { readObject } from "@/lib/storage";

// The Deploy API (docs/plexo-projects/ARCHITECTURE.md §12): other apps send a React project
// (or a ready-built static site) and get a preview link — and a live link if they publish.
// Same pipeline as everything else; nothing special to maintain.

export class DeployError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

const SKIP = /^(node_modules|\.git|\.next|\.vercel|\.turbo|coverage)\//;

/** Files from an uploaded .zip. A zip of a folder (everything under one top-level directory)
 * is unwrapped, so "my-app/src/App.tsx" becomes "src/App.tsx". */
export async function filesFromZip(zipBytes: Buffer): Promise<FileWrite[]> {
  const zip = await JSZip.loadAsync(zipBytes);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith("__MACOSX/") && !f.name.endsWith(".DS_Store"));
  const tops = new Set(entries.map((f) => f.name.split("/")[0]));
  const strip = tops.size === 1 && entries.every((f) => f.name.includes("/")) ? `${[...tops][0]}/` : "";
  const out: FileWrite[] = [];
  let total = 0;
  for (const f of entries) {
    const path = f.name.slice(strip.length);
    if (!path || SKIP.test(path)) continue;
    if (out.length >= PROJECT_LIMITS.maxFiles) throw new DeployError(`The zip has more than ${PROJECT_LIMITS.maxFiles} files (after leaving out node_modules). Leave out build output and dependencies.`);
    const bytes = await f.async("nodebuffer");
    total += bytes.length;
    if (total > PROJECT_LIMITS.maxTotalBytes) throw new DeployError(`The project is over ${PROJECT_LIMITS.maxTotalBytes / 1024 / 1024} MB unzipped.`);
    out.push(isTextContentType(contentTypeForPath(path)) ? { path, content: bytes.toString("utf8") } : { path, base64: bytes.toString("base64") });
  }
  if (!out.length) throw new DeployError("The zip is empty.");
  return out;
}

export async function filesFromUpload(organizationId: string, uploadUrl: string): Promise<FileWrite[]> {
  if (!uploadUrl.includes(`/private/deploy-uploads/${organizationId}/`)) throw new DeployError("That upload doesn't belong to this account.", 403);
  const { body } = await readObject(uploadUrl).catch(() => {
    throw new DeployError("That upload wasn't found — upload the zip first, then deploy within an hour.", 404);
  });
  return filesFromZip(body);
}

export type DeployInput = {
  appId?: string;
  name?: string;
  files: FileWrite[];
  /** Replace the whole project (files not sent are deleted). Default true for a full upload. */
  replace?: boolean;
  publish?: boolean;
  subdomain?: string;
  message?: string;
};

export async function deploy(owner: ProjectOwner, input: DeployInput) {
  if (!input.files.length) throw new DeployError("Send at least one file.");
  // A full React project ships its own package.json; a plain site or a dist/ folder doesn't,
  // and is published as-is. Either way, the scaffold is never mixed into deployed code.
  const isProject = input.files.some((f) => f.path.replace(/^\.?\//, "") === "package.json");
  const isStatic = !isProject && input.files.some((f) => f.path.replace(/^\.?\//, "") === "index.html");
  if (!isProject && !isStatic && !input.appId) {
    throw new DeployError("Send either a React project (with package.json) or a built site (with index.html at the top level).");
  }

  let appId = input.appId;
  if (appId) {
    const { data: app } = await Template.get({ id: appId }).go();
    if (!app || app.organizationId !== owner.organizationId || app.sourceType !== "REACT_PROJECT") throw new DeployError("App not found.", 404);
    for (const batch of chunk(input.files, PROJECT_LIMITS.maxFilesPerWrite)) await writeFiles(appId, batch, owner.userId);
    if (input.replace !== false) {
      const sent = new Set(input.files.map((f) => f.path.replace(/^\.?\//, "")));
      const stale = (await listFiles(appId)).map((f) => f.path).filter((p) => !sent.has(p));
      if (stale.length) await deleteFiles(appId, stale);
    }
  } else {
    const created = await createProject(owner, { name: input.name?.trim() || "Deployed app", files: input.files, useScaffold: false, source: "deploy" });
    appId = created.templateId;
  }

  const actor = { userId: owner.userId, organizationId: owner.organizationId, userName: owner.userName };
  const build = input.publish
    ? await startPublish(appId, actor, { subdomain: input.subdomain })
    : await startPreview(appId, actor, { message: input.message ?? "Deployed", source: "deploy" });
  const { data: app } = await Template.get({ id: appId }).go({ attributes: ["previewHost"] });
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return {
    appId,
    buildId: build.id,
    versionId: build.versionId,
    previewUrl: app?.previewHost ? previewUrl(app.previewHost) : null,
    statusUrl: `${base}/api/v1/deploy/${build.id}`,
    editorUrl: `${base}/dashboard/apps/${appId}`,
  };
}
