import { createHash } from "node:crypto";
import { readTextFile, writeFiles } from "./fileStore";
import { SCAFFOLD_FILES } from "./scaffold";

// Every app carries its own copy of Plexo's client (src/lib/plexo.ts), so a fix to it only
// reaches new apps — unless an existing app's copy is upgraded too. Before a build, a copy
// that is byte-for-byte an earlier Plexo version (never edited by SOL or the owner) is
// replaced with the current one, as an ordinary change that shows in the app's history.
// An edited copy is never touched.

const CLIENT_PATH = "src/lib/plexo.ts";

/** sha256 of every earlier version of the client Plexo shipped. */
const EARLIER_CLIENTS = new Set([
  // Until 2026-10: functions.invoke returned the reply's `data` field instead of the reply
  // itself, so { url } from a server function arrived as null ("Couldn't start checkout").
  "78ab96c662a4fe9deddf882534fd3e5089d0baef3191a5a45a72d4ff863c2c18",
]);

/** True when the app's client was upgraded. */
export async function upgradeAppClient(templateId: string, updatedBy?: string): Promise<boolean> {
  const current = await readTextFile(templateId, CLIENT_PATH);
  if (current === null) return false;
  const hash = createHash("sha256").update(current).digest("hex");
  if (!EARLIER_CLIENTS.has(hash)) return false;
  const latest = SCAFFOLD_FILES[CLIENT_PATH];
  if (!latest || latest === current) return false;
  await writeFiles(templateId, [{ path: CLIENT_PATH, content: latest }], updatedBy);
  return true;
}
