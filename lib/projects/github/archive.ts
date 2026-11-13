import { GitHubError, installationToken } from "./client";
import { SSR_MAX_ZIP_BYTES } from "@/lib/projects/ssrSource";

// Downloads a repository (or one branch, tag, or commit) as a zip, using the Plexo GitHub app's
// installation token. The zip is the same kind a person would upload, so the server-app build
// (inspect, budget, build, deploy, publish) runs on it unchanged. GitHub wraps the files in one
// top-level folder; the inspector already accepts that.

const TIMEOUT_MS = 90_000;

function refPath(ref: string | null): string {
  // Encode each segment, keeping "/" so branch names like feature/x still resolve.
  return ref ? `/${ref.split("/").map(encodeURIComponent).join("/")}` : "";
}

export async function downloadRepoZip(installationId: number, repoFullName: string, ref: string | null): Promise<Uint8Array> {
  const token = await installationToken(installationId);
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/zipball${refPath(ref)}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) throw new GitHubError("Couldn't find that repository or branch on GitHub. Check the name and branch, then try again.", 404);
  if (res.status === 409) throw new GitHubError("That repository is empty. Add some code to it on GitHub, then try again.", 409);
  if (!res.ok || !res.body) throw new GitHubError(`GitHub wouldn't send the code (${res.status}). Try again.`, res.status >= 500 ? 502 : res.status);

  const declared = Number(res.headers.get("content-length") ?? 0);
  const tooBig = () => new GitHubError(`That repository is over the ${SSR_MAX_ZIP_BYTES / 1024 / 1024}MB limit for server apps.`, 413);
  if (declared > SSR_MAX_ZIP_BYTES) throw tooBig();

  // Read as a stream so an oversized repo stops early instead of filling memory first.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > SSR_MAX_ZIP_BYTES) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  const zip = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    zip.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return zip;
}
