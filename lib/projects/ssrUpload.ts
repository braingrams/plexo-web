import { randomUUID } from "node:crypto";
import { projectPrefix } from "@/lib/projects/blobStore";

// A server-rendered app's zip is uploaded straight to the project bucket, then the build is queued
// from that object. The staging object lives under the app's own prefix, so only that app's
// uploads can be queued by its routes (see isSsrUploadKey).

export function ssrUploadPrefix(templateId: string): string {
  return `${projectPrefix(templateId)}/ssr/uploads/`;
}

export function newSsrUploadKey(templateId: string): string {
  return `${ssrUploadPrefix(templateId)}${randomUUID()}.zip`;
}

/** True only for a key this app's upload route issued: under its own prefix, a plain .zip name,
 * and no path tricks. */
export function isSsrUploadKey(templateId: string, key: string): boolean {
  const prefix = ssrUploadPrefix(templateId);
  if (!key.startsWith(prefix) || !key.endsWith(".zip")) return false;
  const name = key.slice(prefix.length);
  return /^[0-9a-f-]{36}\.zip$/.test(name);
}
