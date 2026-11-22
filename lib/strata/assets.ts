import { StrataError } from "@charisol/plexo-sdk/v2/strata";
import { UploadedImage } from "@/lib/db/coreEntities";
import { safeFetch } from "@/lib/siteImport/fetchSafe";
import { loadStrataToken } from "./session";
import { strataApiUrl } from "./server";

// Sharing pictures, logos and videos between a Strata project and a site's images.
//
// Bringing them in is by LINK: the site's image library gets an entry that points at the file where Strata serves it, so
// nothing is downloaded or stored twice and a replaced logo in Strata shows up here. Sending goes the other way: the file
// is read from the owner's own library (never from an address the browser supplies) and uploaded to the project.

export type StrataAssetItem = { id: string; name: string; kind: "image" | "video"; url: string; type?: string; role?: string; mimeType?: string };

const MAX_SEND_FILES = 20;
const MAX_SEND_BYTES = 8 * 1024 * 1024;
const SENDABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);

type Raw = Record<string, unknown>;

async function strata(userId: string, path: string, init: { method?: string; form?: FormData } = {}): Promise<Raw> {
  const base = strataApiUrl();
  if (!base) throw new StrataError("Saving your brand isn't available on this Plexo yet.", "server", 503);
  const token = await loadStrataToken(userId);
  if (!token) throw new StrataError("Your brand sign-in has run out. Reconnect your brand to continue.", "expired", 401);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method: init.method ?? "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, body: init.form });
  } catch {
    throw new StrataError("Couldn't reach your brand. Check your connection and try again.", "network");
  }
  const body = (await res.json().catch(() => ({}))) as Raw;
  if (res.ok) return body;
  if (res.status === 401) throw new StrataError("Your brand sign-in has run out. Reconnect your brand to continue.", "expired", 401);
  if (res.status === 403) throw new StrataError("You can see this brand but not change it. Ask its owner for edit access.", "forbidden", 403);
  if (res.status === 404) throw new StrataError("That brand wasn't found. It may have been deleted, or you may no longer have access.", "not_found", 404);
  throw new StrataError("Something went wrong with your brand. Please try again in a moment.", "server", res.status);
}

/** A project's pictures and videos (fonts, documents and the like are left out). */
export async function listStrataAssets(userId: string, projectId: string): Promise<StrataAssetItem[]> {
  const body = await strata(userId, `/projects/${encodeURIComponent(projectId)}/assets`);
  const rows = Array.isArray(body.data) ? (body.data as Raw[]) : [];
  return rows.flatMap((a): StrataAssetItem[] => {
    const mime = typeof a.mimeType === "string" ? a.mimeType : "";
    const kind = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : null;
    if (!kind || typeof a.cdnUrl !== "string" || !a.cdnUrl.startsWith("https://") || a.status === "DEPRECATED") return [];
    return [{ id: String(a.assetId), name: String(a.name ?? a.fileName ?? "Untitled"), kind, url: a.cdnUrl, type: typeof a.type === "string" ? a.type : undefined, role: typeof a.role === "string" ? a.role : undefined, mimeType: mime }];
  });
}

/** Adds the chosen assets to the owner's images by link. What gets added is what Strata says, not what the browser sent. */
export async function importStrataAssets(input: { userId: string; organizationId: string; projectId: string; ids: string[] }): Promise<{ added: number }> {
  const wanted = new Set(input.ids);
  const assets = (await listStrataAssets(input.userId, input.projectId)).filter((a) => wanted.has(a.id));
  const { data: existing } = await UploadedImage.query.byUser({ userId: input.userId }).go({ pages: "all" });
  const have = new Set(existing.map((i) => i.url));
  let added = 0;
  for (const a of assets) {
    if (have.has(a.url)) continue;
    await UploadedImage.create({ id: crypto.randomUUID(), userId: input.userId, organizationId: input.organizationId, name: a.name, url: a.url }).go();
    added += 1;
  }
  return { added };
}

/** Sends images from the owner's library to a project. Ones Strata already holds (same file) are skipped. */
export async function sendMediaToStrata(input: { userId: string; projectId: string; mediaIds: string[] }): Promise<{ sent: number; skipped: number }> {
  if (input.mediaIds.length > MAX_SEND_FILES) throw new StrataError(`Send up to ${MAX_SEND_FILES} images at a time.`, "invalid", 400);
  const { data: library } = await UploadedImage.query.byUser({ userId: input.userId }).go({ pages: "all" });
  const wanted = new Set(input.mediaIds);
  const chosen = library.filter((i) => wanted.has(i.id));
  const body = await strata(input.userId, `/projects/${encodeURIComponent(input.projectId)}/assets`);
  const theirs = Array.isArray(body.data) ? (body.data as Raw[]) : [];
  const known = new Set(theirs.flatMap((a) => [a.cdnUrl, (a.metadata as Raw | undefined)?.sourceUrl].filter((v): v is string => typeof v === "string")));
  let sent = 0;
  let skipped = 0;
  for (const image of chosen) {
    if (known.has(image.url)) { skipped += 1; continue; }
    let file: Blob;
    try {
      const res = await safeFetch(image.url, { headers: { Accept: "image/*" } });
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!res.ok || !SENDABLE.has(type)) throw new Error("not an image");
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_SEND_BYTES) throw new Error("too large");
      file = new Blob([new Uint8Array(bytes)], { type });
    } catch {
      throw new StrataError(`Couldn't read “${image.name}” to send it. Check it still opens, then try again.`, "invalid", 400);
    }
    const form = new FormData();
    form.append("type", "ILLUSTRATION");
    form.append("role", "BRAND_IMAGE");
    form.append("name", image.name);
    form.append("metadata", JSON.stringify({ sourceUrl: image.url, from: "plexo" }));
    form.append("file", file, image.name.replace(/[^\w.-]+/g, "-") || "image");
    await strata(input.userId, `/projects/${encodeURIComponent(input.projectId)}/assets`, { method: "POST", form });
    sent += 1;
  }
  return { sent, skipped };
}
