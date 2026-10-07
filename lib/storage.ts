import { S3Client, PutObjectCommand, DeleteObjectsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

// Replaces @vercel/blob (see cdk/lib/data-stack.ts's UserContentBucket comment for the
// full rationale). Every function here mirrors the Vercel Blob call it replaces closely
// enough that swapping a call site is mostly mechanical — see each function's own doc
// comment for which Vercel Blob function it stands in for.

const REGION = process.env.AWS_REGION || "us-east-1";
let client: S3Client | null = null;
function s3(): S3Client {
  // Adaptive retries: a migration uploads thousands of files in bursts, and S3 answers a
  // burst with SlowDown ("Please reduce your request rate") — retry with back-off.
  if (!client) client = new S3Client({ region: REGION, maxAttempts: 10, retryMode: "adaptive" });
  return client;
}

function bucketName(): string {
  const name = process.env.USER_CONTENT_BUCKET_NAME;
  if (!name) throw new Error("USER_CONTENT_BUCKET_NAME is not configured — lib/ssmEnv.ts should have loaded it at cold start.");
  return name;
}

function publicUrlFor(key: string): string {
  return `https://${bucketName()}.s3.${REGION}.amazonaws.com/${key}`;
}

/** Extracts the S3 key from a URL this module minted (publicUrlFor's inverse). Throws on
 * a URL from a different bucket/format — every real caller only ever passes back a URL
 * this module itself produced. */
function keyFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\//, "");
}

export class StorageError extends Error {}

/** True if `url` was actually minted by publicUrlFor above (i.e. this module owns the
 * object it points at) — lets a caller safely decide "is it OK to deleteObjects(this)"
 * before doing so, instead of risking a delete call built from parsing an arbitrary
 * external URL a user pasted in (e.g. branding's Logo URL field, which accepts either an
 * upload from this module OR a plain external link). */
export function isOwnedStorageUrl(url: string): boolean {
  try {
    return new URL(url).hostname === `${bucketName()}.s3.${REGION}.amazonaws.com`;
  } catch {
    return false;
  }
}

/** Replaces put(path, buffer, {access, contentType}) — access:"public" objects live
 * under "public/", readable by anyone via the bucket's scoped public-read policy;
 * access:"private" objects live under "private/", never publicly readable. */
export async function uploadObject(
  path: string,
  body: Buffer | Uint8Array,
  opts: { access: "public" | "private"; contentType: string },
): Promise<{ url: string }> {
  const key = `${opts.access}/${path}`;
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: key,
        Body: body,
        ContentType: opts.contentType,
      }),
    );
  } catch (err) {
    throw new StorageError(err instanceof Error ? err.message : "Failed to upload file.");
  }
  return { url: publicUrlFor(key) };
}

/** Replaces del(urls) — accepts the same shape (one URL or an array), silently no-ops on
 * an empty array like the original did. */
export async function deleteObjects(urls: string | string[]): Promise<void> {
  const list = Array.isArray(urls) ? urls : [urls];
  if (list.length === 0) return;
  // DeleteObjects caps at 1000 keys per call.
  for (let i = 0; i < list.length; i += 1000) {
    const batch = list.slice(i, i + 1000);
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucketName(),
        Delete: { Objects: batch.map((url) => ({ Key: keyFromUrl(url) })) },
      }),
    );
  }
}

/** Replaces issueSignedToken({pathname, operations:["get"], validUntil}) +
 * presignUrl(signed, {operation:"get", pathname, access:"private"}) — a short-lived
 * signed GET URL for a private object, same two-step Vercel Blob call collapsed into one. */
export async function getSignedDownloadUrl(privateUrl: string, expiresInSeconds: number): Promise<string> {
  const key = keyFromUrl(privateUrl);
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucketName(), Key: key }), { expiresIn: expiresInSeconds });
}

/** Replaces @vercel/blob/client's browser-direct-upload flow (upload() on the client +
 * handleUpload() on the server) — an S3 presigned POST policy the browser submits
 * straight to S3, bypassing the Lambda entirely for the file bytes (same reason Vercel's
 * version bypassed the Next.js server: serverless request-body size limits). Returns the
 * POST url + form fields the client must include verbatim (see ProductsClient.tsx). */
export async function createPresignedUploadPost(
  path: string,
  opts: { access: "public" | "private"; contentType: string; maxSizeBytes: number },
): Promise<{ url: string; fields: Record<string, string>; publicUrl: string }> {
  const key = `${opts.access}/${path}`;
  const { url, fields } = await createPresignedPost(s3(), {
    Bucket: bucketName(),
    Key: key,
    Conditions: [["content-length-range", 0, opts.maxSizeBytes], ["eq", "$Content-Type", opts.contentType]],
    Fields: { "Content-Type": opts.contentType },
    Expires: 5 * 60,
  });
  return { url, fields, publicUrl: publicUrlFor(key) };
}

/** Reads an object this module minted back into memory — for server-side consumers of a
 * private upload (e.g. SOL handing a chat attachment's bytes to the model, which can't
 * fetch a private URL itself). The bucket comes from the URL rather than
 * USER_CONTENT_BUCKET_NAME because the SOL chat Lambda doesn't load SSM env; it's still
 * restricted to Plexo's own user-content buckets (the same "plexo-user-content*" scope the
 * IAM grants use), so an arbitrary S3 URL can't be read through this. */
export async function readObject(url: string): Promise<{ body: Buffer; contentType: string | undefined }> {
  let bucket = "";
  let key = "";
  try {
    const parsed = new URL(url);
    const match = parsed.hostname.match(/^(plexo-user-content[a-z0-9.-]*)\.s3\.[a-z0-9-]+\.amazonaws\.com$/);
    bucket = match?.[1] ?? "";
    key = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    // handled below
  }
  if (!bucket || !key) throw new StorageError("Not a Plexo storage URL.");
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType };
  } catch (err) {
    throw new StorageError(err instanceof Error ? err.message : "Failed to read file.");
  }
}
