import { createSign } from "node:crypto";
import { GoogleAnalyticsAdminClient, MockAnalyticsAdminClient, hostOf, type AnalyticsAdminClient, type Provisioned } from "./admin";
import { GoogleApiError } from "./dataClient";

/**
 * Plexo-managed analytics: Plexo creates and owns a Google Analytics property + web data stream for each site inside
 * its OWN Google account(s), through a service account. The site owner never needs a Google account. Reports are read
 * with the same service account.
 *
 * Capacity: Google caps one Analytics account at 2,000 properties. GOOGLE_ANALYTICS_MANAGED_ACCOUNTS lists several
 * Plexo accounts; a new site goes to the first one with room, so the real cap is 2,000 x the number of accounts.
 * When every account is full, the owner simply keeps Plexo's own visit counts (never an error).
 */

export const MANAGED_ACCOUNT_CAP = 2000;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/analytics.edit",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/analytics.manage.users",
];

type ServiceKey = { client_email: string; private_key: string };

/** Thrown when Plexo's managed setup cannot take another site. The caller falls back to basic counts. */
export class ManagedUnavailableError extends Error {
  constructor(readonly reason: "not_configured" | "full") {
    super(reason);
  }
}

function readServiceKey(): ServiceKey | null {
  const raw = process.env.GOOGLE_ANALYTICS_MANAGED_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const json = JSON.parse(text) as Partial<ServiceKey>;
    if (typeof json.client_email !== "string" || typeof json.private_key !== "string") return null;
    return { client_email: json.client_email, private_key: json.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

/** The Plexo-owned Google Analytics accounts new properties are made in, in the order they fill up ("accounts/123"). */
export function managedAccounts(): string[] {
  return (process.env.GOOGLE_ANALYTICS_MANAGED_ACCOUNTS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^accounts\//, ""))
    .filter((s) => /^\d+$/.test(s))
    .map((id) => `accounts/${id}`);
}

export function isManagedConfigured(): boolean {
  return !!readServiceKey() && managedAccounts().length > 0;
}

/** Dev/preview without the service account: managed setup is simulated with sample data. Never automatic in production. */
export function isManagedMock(): boolean {
  return process.env.GOOGLE_ANALYTICS_MOCK === "1" || (!isManagedConfigured() && process.env.NODE_ENV !== "production");
}

/** Managed setup can be offered (for real, or as the sample version in dev). */
export function isManagedAvailable(): boolean {
  return isManagedConfigured() || isManagedMock();
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** The signed request Google exchanges for an access token (RFC 7523). Exported for tests; contains no secret beyond the signature. */
export function buildServiceAssertion(key: ServiceKey, now = Date.now()): string {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const iat = Math.floor(now / 1000);
  const claims = b64u(JSON.stringify({ iss: key.client_email, scope: SCOPES.join(" "), aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key);
  return `${header}.${claims}.${b64u(signature)}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** A short-lived access token for Plexo's service account, remembered until a few minutes before it expires. Never logged. */
export async function serviceAccessToken(): Promise<string> {
  if (isManagedMock()) return "mock-managed-token";
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60_000) return cachedToken.token;
  const key = readServiceKey();
  if (!key) throw new ManagedUnavailableError("not_configured");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: buildServiceAssertion(key) }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) throw new GoogleApiError(res.status === 400 ? 401 : res.status, `Google would not sign Plexo in (${res.status})`);
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

/** Google's "you are out of room" answers: a full account (400 mentioning the limit) or a busy quota (429). */
export function isCapacityError(err: unknown): boolean {
  if (!(err instanceof GoogleApiError)) return false;
  return err.status === 429 || (err.status === 400 && /limit|quota|too many|maximum|exceed|reached/i.test(err.message));
}

export async function managedAdminClient(): Promise<AnalyticsAdminClient> {
  return isManagedMock() ? new MockAnalyticsAdminClient() : new GoogleAnalyticsAdminClient(await serviceAccessToken());
}

/**
 * Makes the property and web data stream for a site in the first Plexo account that has room. The owner's email and
 * name are never sent to Google; the property is named after the site's address.
 */
export async function createManagedProperty(siteUrl: string, accounts: string[] = managedAccounts()): Promise<Provisioned> {
  const admin = await managedAdminClient();
  const list = isManagedMock() && accounts.length === 0 ? ["accounts/1"] : accounts;
  if (list.length === 0) throw new ManagedUnavailableError("not_configured");
  const host = hostOf(siteUrl);
  for (const account of list) {
    try {
      return await admin.createPropertyWithStream(account, siteUrl, `${host} (Plexo)`);
    } catch (err) {
      if (isCapacityError(err)) continue; // this account is full: try the next one
      throw err;
    }
  }
  throw new ManagedUnavailableError("full");
}

/** Move a managed property to Google's trash (kept by Google for 35 days). Best effort: clean-up never blocks the owner. */
export async function deleteManagedProperty(propertyName: string): Promise<void> {
  if (isManagedMock() || !/^properties\/\d+$/.test(propertyName)) return;
  try {
    const token = await serviceAccessToken();
    await fetch(`https://analyticsadmin.googleapis.com/v1beta/${propertyName}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    // Left in Plexo's account; the next sweep run tries again only if the row is still there.
  }
}

/** Is this property one Plexo made? Guards every managed read so a stored value can never point at somebody else's account. */
export function isOurPropertyName(propertyName: string | undefined | null): propertyName is string {
  return !!propertyName && /^properties\/\d+$/.test(propertyName);
}

/**
 * "Hand over to my Google account": give the owner's Google account the Editor role on the property (Admin API access
 * bindings). Plexo keeps its own access so reports keep working. Needs the analytics.manage.users permission.
 */
export async function grantAccess(propertyName: string, email: string): Promise<void> {
  if (isManagedMock()) return;
  if (!isOurPropertyName(propertyName)) throw new GoogleApiError(400, "bad property");
  const token = await serviceAccessToken();
  const res = await fetch(`https://analyticsadmin.googleapis.com/v1alpha/${propertyName}/accessBindings`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ user: email, roles: ["predefinedRoles/editor"] }),
    cache: "no-store",
  });
  if (!res.ok && res.status !== 409) throw new GoogleApiError(res.status, `Google answered ${res.status}`);
}

export const EMAIL_PATTERN = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,255}\.[^\s@<>"]{2,}$/;
