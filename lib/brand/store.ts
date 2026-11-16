import { gunzipSync, gzipSync } from "node:zlib";
import { DeleteObjectsCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";

// Where a site's linked brand lives (lib/brand/siteBrand.ts), at STABLE keys in the user-content bucket:
//   private/site-brand/<siteId>/design-system.json.gz  — the design system as last pulled from Strata (the source the sheet is made from)
//   public/__plexo/brand/<siteId>.css                  — the hosted brand sheet every page links to
// A stable key (rather than content-addressed) is the point: pages link to /__plexo/brand/<siteId>.css and never need
// recompiling when the brand changes; ?v=<revision> on the link is what moves caches on.

export const BRAND_SHEET_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

export interface BrandBackend {
  putSheet(siteId: string, css: string): Promise<void>;
  getSheet(siteId: string): Promise<string | null>;
  putDesignSystem(siteId: string, ds: DesignSystem): Promise<void>;
  getDesignSystem(siteId: string): Promise<DesignSystem | null>;
  remove(siteId: string): Promise<void>;
}

const SITE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const isSiteId = (id: unknown): id is string => typeof id === "string" && SITE_ID.test(id);
export const brandSheetKey = (siteId: string): string => `public/__plexo/brand/${siteId}.css`;
export const brandDesignSystemKey = (siteId: string): string => `private/site-brand/${siteId}/design-system.json.gz`;
/** The address a page links to, on its own domain. */
export const brandSheetPath = (siteId: string): string => `/__plexo/brand/${siteId}.css`;

const REGION = process.env.AWS_REGION || "us-east-1";
let client: S3Client | null = null;
const s3 = () => (client ??= new S3Client({ region: REGION, maxAttempts: 5, retryMode: "adaptive" }));
const bucket = (): string => {
  const name = process.env.USER_CONTENT_BUCKET_NAME;
  if (!name) throw new Error("Storage isn't set up on this Plexo yet.");
  return name;
};

async function read(key: string): Promise<Buffer | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch (err) {
    if (err instanceof NoSuchKey || (err as { name?: string })?.name === "NoSuchKey") return null;
    throw err;
  }
}

const s3Backend: BrandBackend = {
  async putSheet(siteId, css) {
    await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: brandSheetKey(siteId), Body: css, ContentType: "text/css; charset=utf-8", CacheControl: BRAND_SHEET_CACHE_CONTROL }));
  },
  async getSheet(siteId) {
    const body = await read(brandSheetKey(siteId));
    return body ? body.toString("utf8") : null;
  },
  async putDesignSystem(siteId, ds) {
    await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: brandDesignSystemKey(siteId), Body: gzipSync(JSON.stringify(ds)), ContentType: "application/gzip" }));
  },
  async getDesignSystem(siteId) {
    const body = await read(brandDesignSystemKey(siteId));
    return body ? (JSON.parse(gunzipSync(body).toString("utf8")) as DesignSystem) : null;
  },
  async remove(siteId) {
    await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: [{ Key: brandSheetKey(siteId) }, { Key: brandDesignSystemKey(siteId) }] } }));
  },
};

let backend: BrandBackend = s3Backend;
export const brandStore = (): BrandBackend => backend;
/** Tests swap in an in-memory store. */
export function setBrandBackend(next: BrandBackend | null): void {
  backend = next ?? s3Backend;
}
