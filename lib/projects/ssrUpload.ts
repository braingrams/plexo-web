import { projectPrefix } from "@/lib/projects/blobStore";

// A server-rendered app's zip is staged in the project bucket, in parts sent through this app
// (ssr-upload/chunk), then assembled into one object. ssr-deploy queues the build from that object.
// Keys sit under the app's own prefix, so an app can only queue its own uploads (isSsrUploadKey).

export function ssrUploadPrefix(templateId: string): string {
  return `${projectPrefix(templateId)}/ssr/uploads/`;
}

export function ssrStagingPrefix(templateId: string, session: string): string {
  return `${ssrUploadPrefix(templateId)}${session}/`;
}

export function ssrAssembledKey(templateId: string, session: string): string {
  return `${ssrUploadPrefix(templateId)}${session}.zip`;
}

/** True only for a key the chunk route assembled for this app: under its own prefix, a plain
 * <uuid>.zip name, and no path tricks. */
export function isSsrUploadKey(templateId: string, key: string): boolean {
  const prefix = ssrUploadPrefix(templateId);
  if (!key.startsWith(prefix) || !key.endsWith(".zip")) return false;
  const name = key.slice(prefix.length);
  return /^[0-9a-f-]{36}\.zip$/.test(name);
}
