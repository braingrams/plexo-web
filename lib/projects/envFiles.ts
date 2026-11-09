// Environment files never leave the customer's machine, and never reach the build. A client env file
// (.env, .env.local, .env.production, .envrc, prod.env, ...) holds values the browser would expose, and
// its secrets belong in Plexo's Variables and Secrets tabs. Every upload path calls these helpers: the
// browser before sending, the upload routes when they receive the zip, and the build worker when it unpacks it.

import JSZip from "jszip";

import { isEnvFilePath, envFilesDroppedMessage } from "./envFileNames";

export { isEnvFilePath, envFilesDroppedMessage };

/** Removes env files from a zip. Returns the cleaned zip bytes (or the original bytes when there is nothing to drop) and the paths removed. */
export async function removeEnvFilesFromZip(buffer: Uint8Array): Promise<{ bytes: Uint8Array; dropped: string[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const dropped = Object.values(zip.files)
    .filter((entry) => !entry.dir && isEnvFilePath(entry.name))
    .map((entry) => entry.name);
  if (dropped.length === 0) return { bytes: buffer, dropped };
  for (const name of dropped) zip.remove(name);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes, dropped };
}
