import { S3Client, HeadObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { RestError } from "@/lib/appData/rest";
import type { AppContext } from "@/lib/appRuntime/context";
import type { AppUserRow } from "@/lib/appAuth/store";

// File storage for apps built on Plexo (plexo.storage.from(bucket)...). Buckets need no
// setup — the first upload creates one. Access rules, simple enough to explain in one line:
//   public buckets  (avatars, images, media, public, public-*; or set by the owner):
//                    anyone can view files; signed-in visitors upload into their own folder.
//   private buckets (everything else): only the person who uploaded a file can see it
//                    (via short-lived links); uploads go into their own folder.
//   A visitor's folder is "<their user id>/…"; they can only upload into, list and remove
//   files in it. Server functions (service key) can do anything.
//
// S3 layout: {public|private}/apps/<appId>/<env>/<bucket>/<path> in the user-content bucket.
// public/* is world-readable by bucket policy; private/* never is.

export type BucketAccess = "public" | "private";
export type BucketConfig = { access: BucketAccess; maxBytes: number };
export type StorageCaller = { kind: "visitor"; user: AppUserRow | null } | { kind: "service" };

const DEFAULT_PUBLIC = /^(avatars|images|media|public|public-.+)$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{1,62}$/;
const MAX_DEFAULT = 25 * 1024 * 1024;
const MAX_HARD = 200 * 1024 * 1024;

const REGION = process.env.AWS_REGION || "us-east-1";
let s3client: S3Client | null = null;
const s3 = () => (s3client ??= new S3Client({ region: REGION }));
function bucketName(): string {
  const name = process.env.USER_CONTENT_BUCKET_NAME;
  if (!name) throw new Error("USER_CONTENT_BUCKET_NAME is not configured.");
  return name;
}

export function bucketConfig(ctx: AppContext, bucket: string): BucketConfig {
  if (!BUCKET.test(bucket)) throw new RestError(`"${bucket}" isn't a valid bucket name.`, 400, "Use lowercase letters, numbers and dashes, like \"avatars\" or \"documents\".");
  const own = (ctx.settings.buckets as Record<string, Partial<BucketConfig>> | undefined)?.[bucket];
  return {
    access: own?.access ?? (DEFAULT_PUBLIC.test(bucket) ? "public" : "private"),
    maxBytes: Math.min(own?.maxBytes ?? MAX_DEFAULT, MAX_HARD),
  };
}

function cleanPath(raw: unknown): string {
  if (typeof raw !== "string") throw new RestError("A file path is required, like \"<user id>/photo.png\".");
  const path = raw.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!path || path.length > 512 || path.split("/").some((s) => s === "." || s === ".." || !s) || /[\u0000-\u001f\\]/.test(path)) {
    throw new RestError(`"${raw}" isn't a valid file path.`);
  }
  return path;
}

function keyFor(ctx: AppContext, access: BucketAccess, bucket: string, path: string): string {
  return `${access}/apps/${ctx.templateId}/${ctx.env}/${bucket}/${path}`;
}

function publicUrl(key: string): string {
  return `https://${bucketName()}.s3.${REGION}.amazonaws.com/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** The folder a visitor may write to; throws if the path is outside it. */
function assertOwnFolder(caller: StorageCaller, path: string, action: string): void {
  if (caller.kind === "service") return;
  if (!caller.user) throw new RestError(`Sign in to ${action} files.`, 401);
  if (!path.startsWith(`${caller.user.id}/`)) {
    throw new RestError(`You can only ${action} files in your own folder.`, 403, `Start the path with the user's id: \`\${user.id}/file.png\`.`);
  }
}

export async function signUpload(ctx: AppContext, caller: StorageCaller, bucket: string, body: { path?: unknown; contentType?: unknown; size?: unknown; upsert?: unknown }) {
  const cfg = bucketConfig(ctx, bucket);
  const path = cleanPath(body.path);
  assertOwnFolder(caller, path, "upload");
  const contentType = typeof body.contentType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(body.contentType) ? body.contentType : "application/octet-stream";
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) throw new RestError("The file is empty.");
  if (size > cfg.maxBytes) throw new RestError(`That file is ${(size / 1024 / 1024).toFixed(1)} MB; this bucket accepts up to ${Math.round(cfg.maxBytes / 1024 / 1024)} MB.`, 413);
  // Files that a browser would run as a page are only stored privately, never as public
  // same-site HTML (which could be used to phish under the app's name).
  if (cfg.access === "public" && /^(text\/html|application\/xhtml|image\/svg)/.test(contentType)) {
    throw new RestError("HTML and SVG files can't go in a public bucket.", 400, "Put them in a private bucket, or convert images to PNG/JPEG/WebP.");
  }
  const key = keyFor(ctx, cfg.access, bucket, path);
  if (body.upsert !== true) {
    const exists = await s3().send(new HeadObjectCommand({ Bucket: bucketName(), Key: key })).then(() => true, () => false);
    if (exists) throw new RestError("A file already exists at that path.", 409, "Pass { upsert: true } to replace it.");
  }
  const { url, fields } = await createPresignedPost(s3(), {
    Bucket: bucketName(),
    Key: key,
    Conditions: [["content-length-range", 1, cfg.maxBytes], ["eq", "$Content-Type", contentType]],
    Fields: { "Content-Type": contentType },
    Expires: 10 * 60,
  });
  return { url, fields, path, publicUrl: cfg.access === "public" ? publicUrl(key) : null };
}

export async function signDownload(ctx: AppContext, caller: StorageCaller, bucket: string, body: { path?: unknown; expiresIn?: unknown }) {
  const cfg = bucketConfig(ctx, bucket);
  const path = cleanPath(body.path);
  if (cfg.access === "private") assertOwnFolder(caller, path, "view");
  const key = keyFor(ctx, cfg.access, bucket, path);
  const expiresIn = Math.min(Math.max(Number(body.expiresIn) || 3600, 60), 7 * 24 * 3600);
  if (cfg.access === "public") return { signedUrl: publicUrl(key) };
  return { signedUrl: await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucketName(), Key: key }), { expiresIn }) };
}

export async function removeFiles(ctx: AppContext, caller: StorageCaller, bucket: string, body: { paths?: unknown }) {
  const cfg = bucketConfig(ctx, bucket);
  if (!Array.isArray(body.paths) || !body.paths.length) throw new RestError("Pass the paths to remove.");
  if (body.paths.length > 1000) throw new RestError("Remove at most 1000 files at once.");
  const paths = body.paths.map(cleanPath);
  paths.forEach((p) => assertOwnFolder(caller, p, "remove"));
  await s3().send(new DeleteObjectsCommand({ Bucket: bucketName(), Delete: { Objects: paths.map((p) => ({ Key: keyFor(ctx, cfg.access, bucket, p) })) } }));
  return { removed: paths };
}

export async function listFiles(ctx: AppContext, caller: StorageCaller, bucket: string, prefix: string) {
  const cfg = bucketConfig(ctx, bucket);
  const cleanPrefix = prefix.replace(/^\/+/, "");
  if (caller.kind !== "service") {
    if (!caller.user) throw new RestError("Sign in to list files.", 401);
    if (cleanPrefix && !cleanPrefix.startsWith(`${caller.user.id}/`) && cleanPrefix !== caller.user.id) {
      throw new RestError("You can only list files in your own folder.", 403);
    }
  }
  const scope = caller.kind === "service" ? cleanPrefix : cleanPrefix || `${(caller.user as AppUserRow).id}/`;
  const base = keyFor(ctx, cfg.access, bucket, "");
  const res = await s3().send(new ListObjectsV2Command({ Bucket: bucketName(), Prefix: `${base}${scope}`, MaxKeys: 1000 }));
  return (res.Contents ?? []).map((o) => ({
    path: o.Key!.slice(base.length),
    size: o.Size ?? 0,
    createdAt: o.LastModified?.toISOString() ?? null,
    publicUrl: cfg.access === "public" ? publicUrl(o.Key!) : null,
  }));
}
