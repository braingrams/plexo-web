import { createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";

// Content-addressed storage for project files, version manifests and build output, all in
// the user-content bucket under private/ (never publicly readable — a preview build of an
// unpublished app must not be reachable by S3 URL). Layout:
//   private/projects/<templateId>/blobs/<sha256>          file bodies, written once
//   private/projects/<templateId>/versions/<versionId>.json  version manifests
//   private/projects/<templateId>/builds/<buildId>/site/…    built site (served by /pub)
//   private/projects/<templateId>/builds/<buildId>/result.json  build outcome
//   private/projects/<templateId>/builds/<buildId>/functions/<name>.zip  function bundles

const REGION = process.env.AWS_REGION || "us-east-1";
let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) client = new S3Client({ region: REGION, maxAttempts: 10, retryMode: "adaptive" });
  return client;
}

export function projectBucket(): string {
  const name = process.env.USER_CONTENT_BUCKET_NAME;
  if (!name) throw new Error("USER_CONTENT_BUCKET_NAME is not configured.");
  return name;
}

export const projectPrefix = (templateId: string) => `private/projects/${templateId}`;
export const blobKey = (templateId: string, sha: string) => `${projectPrefix(templateId)}/blobs/${sha}`;
export const versionManifestKey = (templateId: string, versionId: string) => `${projectPrefix(templateId)}/versions/${versionId}.json`;
export const buildPrefix = (templateId: string, buildId: string) => `${projectPrefix(templateId)}/builds/${buildId}`;
export const buildSitePrefix = (templateId: string, buildId: string) => `${buildPrefix(templateId, buildId)}/site`;
export const buildResultKey = (templateId: string, buildId: string) => `${buildPrefix(templateId, buildId)}/result.json`;

export function sha256(body: Uint8Array | string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Stores a file body under its own hash. Skips the upload when that exact content is
 * already stored — the common case for a save that only touched a few files. */
export async function putBlob(templateId: string, body: Uint8Array, contentType: string): Promise<string> {
  const sha = sha256(body);
  const key = blobKey(templateId, sha);
  if (!(await objectExists(key))) {
    await s3().send(new PutObjectCommand({ Bucket: projectBucket(), Key: key, Body: body, ContentType: contentType }));
  }
  return sha;
}

export async function getBlob(templateId: string, sha: string): Promise<Buffer> {
  const object = await getObject(blobKey(templateId, sha));
  if (!object) throw new Error(`A file's stored content is missing (${sha.slice(0, 12)}).`);
  return object.body;
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: projectBucket(), Key: key }));
    return true;
  } catch (err: any) {
    if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType?: string; etag?: string } | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: projectBucket(), Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType, etag: res.ETag };
  } catch (err: any) {
    if (err instanceof NoSuchKey || err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function putObject(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: projectBucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function putJson(key: string, value: unknown): Promise<void> {
  await putObject(key, JSON.stringify(value), "application/json");
}

export async function getJson<T>(key: string): Promise<T | null> {
  const object = await getObject(key);
  return object ? (JSON.parse(object.body.toString("utf8")) as T) : null;
}

/** Deletes everything under a prefix — used when a project is deleted. */
export async function deletePrefix(prefix: string): Promise<void> {
  let token: string | undefined;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: projectBucket(), Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) await s3().send(new DeleteObjectsCommand({ Bucket: projectBucket(), Delete: { Objects: keys } }));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}
