import { createHash, createHmac, createPrivateKey, timingSafeEqual } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

// The Plexo GitHub App: app-level JWTs, per-installation access tokens, and a small REST
// helper. Configuration (SSM): PLEXO_GITHUB_APP_ID, PLEXO_GITHUB_APP_SLUG, PLEXO_GITHUB_APP_PRIVATE_KEY (PEM),
// PLEXO_GITHUB_APP_WEBHOOK_SECRET.

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function githubConfigured(): boolean {
  return !!(process.env.PLEXO_GITHUB_APP_ID && process.env.PLEXO_GITHUB_APP_PRIVATE_KEY && process.env.PLEXO_GITHUB_APP_SLUG);
}

export function installUrl(state: string): string {
  return `https://github.com/apps/${process.env.PLEXO_GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
}

let appJwt: { token: string; expires: number } | null = null;
async function appToken(): Promise<string> {
  if (appJwt && appJwt.expires > Date.now() + 60_000) return appJwt.token;
  const id = process.env.PLEXO_GITHUB_APP_ID;
  const pem = process.env.PLEXO_GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!id || !pem) throw new GitHubError("GitHub isn't set up on this Plexo environment yet.", 503);
  // GitHub hands out PKCS#1 keys; jose wants PKCS#8.
  const pkcs8 = pem.includes("BEGIN RSA PRIVATE KEY") ? createPrivateKey(pem).export({ type: "pkcs8", format: "pem" }).toString() : pem;
  const key = await importPKCS8(pkcs8, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuedAt(now - 30).setExpirationTime(now + 9 * 60).setIssuer(id).sign(key);
  appJwt = { token, expires: (now + 9 * 60) * 1000 };
  return token;
}

const installationTokens = new Map<number, { token: string; expires: number }>();
export async function installationToken(installationId: number): Promise<string> {
  const cached = installationTokens.get(installationId);
  if (cached && cached.expires > Date.now() + 5 * 60_000) return cached.token;
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${await appToken()}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (!res.ok) throw new GitHubError(res.status === 404 ? "The Plexo GitHub app was removed from that account. Connect GitHub again." : `GitHub refused access (${res.status}).`, res.status);
  const data = (await res.json()) as { token: string; expires_at: string };
  installationTokens.set(installationId, { token: data.token, expires: new Date(data.expires_at).getTime() });
  return data.token;
}

/** Removes the Plexo App from a GitHub account, so Plexo loses access to every repository there.
 * A 404 means it was already removed on GitHub, which counts as done. */
export async function uninstallGitHubApp(installationId: number): Promise<void> {
  const res = await fetch(`${API}/app/installations/${installationId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${await appToken()}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (res.status === 404) return;
  if (!res.ok) throw new GitHubError(`GitHub didn't remove the app from that account (${res.status}). Nothing was disconnected in Plexo; try again.`, res.status >= 500 ? 502 : res.status);
}

export async function gh<T = any>(installationId: number, path: string, init: { method?: string; body?: unknown; allow404?: boolean } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${await installationToken(installationId)}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 404 && init.allow404) return null as T;
  if (res.status === 409 && init.allow404) return null as T; // empty repository
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new GitHubError(detail?.message ? `GitHub: ${detail.message}` : `GitHub request failed (${res.status}).`, res.status);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export function verifyWebhookSignature(body: string, signature: string | null): boolean {
  const secret = process.env.PLEXO_GITHUB_APP_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** A git blob's own id (sha1 of "blob <size>\0<bytes>") — lets Plexo tell which files differ
 * from a GitHub tree without downloading them. */
export function gitBlobSha(body: Buffer): string {
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}
