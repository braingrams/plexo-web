// The visitor session cookie of an app built on Plexo. The "__Host-" prefix makes the
// browser itself enforce Secure + Path=/ + no Domain attribute: the cookie belongs to
// exactly the app's own host and can never be read or overwritten by another app, even one
// on a sibling *.plexopages.com subdomain. HttpOnly keeps it out of reach of page scripts.

import { SESSION_TTL_DAYS } from "./store";

const isLocalHost = (host: string) => host === "localhost" || host.endsWith(".localhost") || host.startsWith("127.");

export function sessionCookieName(host: string): string {
  return isLocalHost(host) ? "plexo-session" : "__Host-plexo-session";
}

function attrs(host: string, maxAgeSeconds: number): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${isLocalHost(host) ? "" : "; Secure"}`;
}

export function sessionSetCookie(host: string, token: string): string {
  return `${sessionCookieName(host)}=${token}; ${attrs(host, SESSION_TTL_DAYS * 24 * 60 * 60)}`;
}

export function sessionClearCookie(host: string): string {
  return `${sessionCookieName(host)}=; ${attrs(host, 0)}`;
}

export function readSessionToken(request: Request, host: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const name = sessionCookieName(host);
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      const value = v.join("=");
      return /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : null;
    }
  }
  return null;
}
