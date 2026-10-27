// One Plexo GitHub App serves staging and production, but a GitHub App has a single webhook
// URL and sends installs back to its first callback URL — both production's. Production
// therefore passes staging's traffic on (PLEXO_GITHUB_RELAY_ORIGIN, set only in production):
// - every verified webhook is forwarded unchanged (same body and signature — both
//   environments share the webhook secret); staging acts only on repositories linked there;
// - an install that staging started is bounced back to staging's own setup route, which
//   checks its own signed state.

const FORWARDED_HEADERS = ["content-type", "x-github-event", "x-github-delivery", "x-hub-signature-256", "x-github-hook-id", "x-github-hook-installation-target-id", "x-github-hook-installation-target-type"];

export function relayOrigin(): string | null {
  const raw = process.env.PLEXO_GITHUB_RELAY_ORIGIN;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Never relay to ourselves (a misconfiguration would loop).
    return url.protocol === "https:" && url.origin !== selfOrigin() ? url.origin : null;
  } catch {
    return null;
  }
}

/** This environment's own origin, carried in install state so the setup route knows where an
 * install started. */
export function selfOrigin(): string {
  return new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
}

export async function forwardWebhook(raw: string, headers: Headers): Promise<void> {
  const origin = relayOrigin();
  if (!origin) return;
  const forward: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = headers.get(name);
    if (value) forward[name] = value;
  }
  try {
    const res = await fetch(`${origin}/api/webhooks/github`, { method: "POST", headers: forward, body: raw, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) console.warn(`[github relay] ${origin} answered ${res.status} for delivery ${forward["x-github-delivery"] ?? "?"}`);
  } catch (err) {
    console.warn(`[github relay] forwarding to ${origin} failed:`, err);
  }
}

/** Where an install should finish when it was started by the relay environment, else null.
 * Only the configured relay origin is ever honoured, so this is never an open redirect. */
export function installBounceTarget(state: string | null, query: URLSearchParams): string | null {
  const origin = relayOrigin();
  if (!origin || !state) return null;
  try {
    const payload = JSON.parse(Buffer.from(state.split(".")[0] ?? "", "base64url").toString("utf8"));
    if (payload?.origin !== origin) return null;
  } catch {
    return null;
  }
  return `${origin}/api/github/setup?${query.toString()}`;
}
