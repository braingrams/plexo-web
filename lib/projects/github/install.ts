import { createHmac, timingSafeEqual } from "node:crypto";
import { GitHubInstallation } from "@/lib/db/projectEntities";
import { GitHubError } from "./client";
import { selfOrigin } from "./relay";

// Connecting an organization to the Plexo GitHub App. GitHub's post-install redirect carries an
// installation id anyone could type, so it's never trusted alone: the app is configured to
// "request user authorization during installation", and the OAuth code that comes back proves
// which installations the person really has access to (GET /user/installations).

const STATE_TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not configured.");
  return s;
}

// appId is set when an app's GitHub tab starts the install. The site wizard starts installs
// before any app exists, so it passes returnTo (an in-app /dashboard/ path) instead.
export type InstallStateInput = { appId?: string | null; organizationId: string; userId: string; returnTo?: string | null };

export function signInstallState(input: InstallStateInput): string {
  const payload = Buffer.from(JSON.stringify({ appId: input.appId ?? null, organizationId: input.organizationId, userId: input.userId, returnTo: input.returnTo ?? null, origin: selfOrigin(), exp: Date.now() + STATE_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export type VerifiedInstallState = { appId: string | null; organizationId: string; userId: string; returnTo: string | null };

export function verifyInstallState(state: string | null): VerifiedInstallState | null {
  if (!state) return null;
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? { appId: data.appId ?? null, organizationId: data.organizationId, userId: data.userId, returnTo: data.returnTo ?? null } : null;
  } catch {
    return null;
  }
}

/** Confirms, with the person's own GitHub authorization, that they can access installationId,
 * and records it for the organization. */
export async function verifyAndRecordInstallation(input: { code: string; installationId: number; organizationId: string; userId: string }): Promise<{ accountLogin: string }> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.PLEXO_GITHUB_APP_CLIENT_ID, client_secret: process.env.PLEXO_GITHUB_APP_CLIENT_SECRET, code: input.code }),
  });
  const token = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
  if (!token?.access_token) throw new GitHubError("GitHub didn't confirm your account. Please connect again.", 401);

  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.github.com/user/installations?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
    if (!res.ok) throw new GitHubError("Couldn't check your GitHub access.", res.status);
    const data = (await res.json()) as { installations: Array<{ id: number; account: { login: string; type: string } }> };
    const match = data.installations.find((i) => i.id === input.installationId);
    if (match) {
      await GitHubInstallation.put({ organizationId: input.organizationId, installationId: match.id, accountLogin: match.account.login, accountType: match.account.type, verifiedBy: input.userId }).go();
      return { accountLogin: match.account.login };
    }
    if (data.installations.length < 100) break;
  }
  throw new GitHubError("Your GitHub account doesn't have access to that installation.", 403);
}

export async function orgInstallations(organizationId: string) {
  const { data } = await GitHubInstallation.query.primary({ organizationId }).go({ pages: "all" });
  return data;
}

export async function assertOrgInstallation(organizationId: string, installationId: number): Promise<void> {
  const { data } = await GitHubInstallation.get({ organizationId, installationId }).go();
  if (!data) throw new GitHubError("That GitHub account isn't connected to this workspace. Connect GitHub first.", 403);
}
