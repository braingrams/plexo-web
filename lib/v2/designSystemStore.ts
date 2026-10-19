import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { isDesignSystemRef, type DesignSystemRef } from "@/lib/v2/design";

// Where a site's design system (its brand: colours, fonts, text sizes, spacing, components — tokens from Strata can number in
// the thousands or far more) lives when it is too big to sit inside a page's database row.
//
// A page row is ONE DynamoDB item (400 KB) that also holds the draft and both compiled documents, so only a small design system
// is kept inline. A large one is stored as a gzipped, content-addressed object in the user-content bucket
//   private/design-systems/<sha256 of the gzipped bytes>.json.gz
// and the page holds a small reference ({ hash, size }) instead. Content-addressing makes the object immutable, so many pages,
// drafts, revisions and duplicates can share one without copying, nothing can overwrite it, and a reference can never point at
// something that later changed. The editor uploads big ones straight to storage (not through the server), and the published page
// is unaffected by the size: the compiler only ever emits the tokens a page actually uses.

/** At or below this many characters of JSON, a design system stays in the page row (nothing changes for ordinary sites). */
export const INLINE_MAX_CHARS = 150_000;
/** The ceiling for what we will store and load for one design system (a safety limit, far above real brands). */
export const MAX_STORED_DESIGN_SYSTEM_BYTES = 64 * 1024 * 1024;
export const MAX_STORED_DESIGN_SYSTEM_CHARS = 256 * 1024 * 1024;

export type { DesignSystemRef };

export const designSystemKey = (hash: string): string => `private/design-systems/${hash}.json.gz`;

export class DesignSystemStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignSystemStoreError";
  }
}

/** The storage behind the store; swapped for an in-memory one in tests. */
export interface DesignSystemBackend {
  has(hash: string): Promise<boolean>;
  put(hash: string, gz: Buffer): Promise<void>;
  get(hash: string): Promise<Buffer | null>;
  presignUpload(hash: string): Promise<{ url: string; fields: Record<string, string> }>;
  presignDownload(hash: string): Promise<string>;
}

const REGION = process.env.AWS_REGION || "us-east-1";
let client: S3Client | null = null;
const s3 = () => (client ??= new S3Client({ region: REGION, maxAttempts: 10, retryMode: "adaptive" }));
const bucket = (): string => {
  const name = process.env.USER_CONTENT_BUCKET_NAME;
  if (!name) throw new DesignSystemStoreError("Storage isn't set up on this Plexo yet.");
  return name;
};

const s3Backend: DesignSystemBackend = {
  async has(hash) {
    try {
      await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: designSystemKey(hash) }));
      return true;
    } catch {
      return false;
    }
  },
  async put(hash, gz) {
    await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: designSystemKey(hash), Body: gz, ContentType: "application/gzip" }));
  },
  async get(hash) {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: designSystemKey(hash) }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  },
  async presignUpload(hash) {
    const { url, fields } = await createPresignedPost(s3(), {
      Bucket: bucket(),
      Key: designSystemKey(hash),
      Conditions: [["content-length-range", 1, MAX_STORED_DESIGN_SYSTEM_BYTES], ["eq", "$Content-Type", "application/gzip"]],
      Fields: { "Content-Type": "application/gzip" },
      Expires: 10 * 60,
    });
    return { url, fields };
  },
  async presignDownload(hash) {
    return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: designSystemKey(hash) }), { expiresIn: 15 * 60 });
  },
};

let backend: DesignSystemBackend = s3Backend;
export const setDesignSystemBackend = (b: DesignSystemBackend | null): void => {
  backend = b ?? s3Backend;
  cache.clear();
};

// Objects are immutable, so a loaded design system can be reused for as long as the process lives (a handful at a time).
const cache = new Map<string, DesignSystem>();
const CACHE_MAX = 8;
const remember = (hash: string, ds: DesignSystem) => {
  cache.delete(hash);
  cache.set(hash, ds);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
};

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Stores a design system (gzipped, under its own hash) and returns the reference a page keeps instead of it. */
export async function storeDesignSystem(ds: DesignSystem): Promise<DesignSystemRef> {
  const json = JSON.stringify(ds);
  if (json.length > MAX_STORED_DESIGN_SYSTEM_CHARS) throw new DesignSystemStoreError("This site's colours and fonts are larger than Plexo can store. Remove unused colours or components in Branding.");
  const gz = gzipSync(json);
  if (gz.length > MAX_STORED_DESIGN_SYSTEM_BYTES) throw new DesignSystemStoreError("This site's colours and fonts are larger than Plexo can store. Remove unused colours or components in Branding.");
  const hash = sha256(gz);
  // Always written (it is the same bytes, so harmless): that refreshes the object's age, which is what keeps the cleanup
  // (lib/db/valueSweep.ts) from ever removing something a page saved just now.
  await backend.put(hash, gz);
  remember(hash, ds);
  return { hash, size: json.length };
}

/** The design system a reference points at. Throws a plain message when it is missing or unreadable. */
export async function loadDesignSystem(ref: DesignSystemRef): Promise<DesignSystem> {
  const hit = cache.get(ref.hash);
  if (hit) return hit;
  let gz: Buffer | null;
  try {
    gz = await backend.get(ref.hash);
  } catch {
    throw new DesignSystemStoreError("This site's colours and fonts couldn't be loaded right now. Please try again in a moment.");
  }
  if (!gz) throw new DesignSystemStoreError("This site's saved colours and fonts weren't found. Open Branding and save them again.");
  // The name is the hash of the content: an object that isn't what its name says (a bad or tampered upload) is never used.
  if (sha256(gz) !== ref.hash) throw new DesignSystemStoreError("This site's saved colours and fonts didn't upload correctly. Please save again.");
  let ds: unknown;
  try {
    // maxOutputLength bounds a decompression bomb to the same ceiling we allow on the way in.
    ds = JSON.parse(gunzipSync(gz, { maxOutputLength: MAX_STORED_DESIGN_SYSTEM_CHARS }).toString("utf8"));
  } catch {
    throw new DesignSystemStoreError("This site's saved colours and fonts couldn't be read. Open Branding and save them again.");
  }
  if (!ds || typeof ds !== "object" || !Array.isArray((ds as DesignSystem).tokens)) throw new DesignSystemStoreError("This site's saved colours and fonts aren't in the right shape. Open Branding and save them again.");
  remember(ref.hash, ds as DesignSystem);
  return ds as DesignSystem;
}

/** True when the object exists (used to accept a reference the editor uploaded straight to storage). */
export const designSystemExists = (hash: string): Promise<boolean> => backend.has(hash);

/** A one-off upload form so the browser can put a big design system straight into storage. */
export const presignDesignSystemUpload = (hash: string) => backend.presignUpload(hash);

// ---------------------------------------------------------------- the two moves a page design makes

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Brings a stored page design's design system back in: when it holds a reference, the real one is loaded and put where the
 * editor, compiler and tools expect it (`designSystem`). Anything else passes through untouched. Call this before reading the
 * brand from a stored design.
 */
export async function resolveDesignSystem<T>(raw: T): Promise<T> {
  if (!isRecord(raw) || raw.designSystem !== undefined || !isDesignSystemRef(raw.designSystemRef)) return raw;
  const { designSystemRef, ...rest } = raw;
  return { ...rest, designSystem: await loadDesignSystem(designSystemRef as DesignSystemRef) } as T;
}

/**
 * Makes a validated page design safe to store in a row: a design system over INLINE_MAX_CHARS moves into storage and the design
 * keeps a reference; a reference the editor uploaded itself is checked to really be there. Small ones are left as they are.
 */
export async function externalizeDesignSystem<T extends { designSystem?: DesignSystem; designSystemRef?: DesignSystemRef }>(design: T): Promise<T> {
  if (design.designSystem) {
    if (JSON.stringify(design.designSystem).length <= INLINE_MAX_CHARS) return design;
    const { designSystem, ...rest } = design;
    return { ...rest, designSystemRef: await storeDesignSystem(designSystem) } as T;
  }
  if (design.designSystemRef) {
    if (!(await backend.has(design.designSystemRef.hash))) throw new DesignSystemStoreError("This site's colours and fonts didn't finish uploading. Please save again.");
    // Make sure it is something we can read back, so a bad upload is caught now and not when the page is next opened.
    await loadDesignSystem(design.designSystemRef);
  }
  return design;
}

/** A short-lived link the browser can fetch the stored design system from directly (it never passes through the server). */
export const designSystemDownloadUrl = (hash: string): Promise<string> => backend.presignDownload(hash);
