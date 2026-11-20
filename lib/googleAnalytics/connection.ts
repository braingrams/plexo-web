import { SiteGoogleAnalytics } from "@/lib/db/opsEntities";
import { PublishedDomain } from "@/lib/db/contentEntities";
import { decryptGoogleAnalyticsToken, encryptGoogleAnalyticsToken } from "@/lib/crypto";
import { GoogleAnalyticsAdminClient, MockAnalyticsAdminClient, hostOf, type AnalyticsAdminClient, type PropertyChoice } from "./admin";
import { GoogleAnalyticsDataClient, GoogleApiError, MockAnalyticsDataClient } from "./dataClient";
import { GoogleAuthError, isGoogleAnalyticsMock, refreshAccessToken, revokeToken } from "./oauth";
import { createManagedProperty, deleteManagedProperty, isManagedMock, isOurPropertyName, serviceAccessToken } from "./managed";
import { organizationHasAnalyticsPlan } from "./ownerPlan";
import { DEFAULT_CONSENT, type ConsentSettings } from "@/lib/consent/model";
import { loadConsentSettings } from "@/lib/consent/settings";
import type { AnalyticsDataClient, RangeDays } from "./types";

type Connection = NonNullable<Awaited<ReturnType<typeof getConnection>>>;

export async function getConnection(templateId: string) {
  const { data } = await SiteGoogleAnalytics.get({ templateId }).go();
  return data ?? null;
}

export async function saveRefreshToken(input: { templateId: string; organizationId: string; userId: string; refreshToken: string; googleEmail?: string }) {
  // A fresh sign-in starts the property step over: a different Google account has different properties.
  await SiteGoogleAnalytics.upsert({
    templateId: input.templateId,
    organizationId: input.organizationId,
    connectedByUserId: input.userId,
    googleEmail: input.googleEmail,
    refreshTokenEncrypted: isGoogleAnalyticsMock() ? "mock" : encryptGoogleAnalyticsToken(input.refreshToken),
    status: "connected",
    mode: "own",
  }).go();
  await SiteGoogleAnalytics.patch({ templateId: input.templateId }).remove(["accountName", "propertyName", "propertyDisplayName", "streamName", "measurementId", "poolAccountName", "handedOverTo", "handedOverAt", "lapsedAt"]).go();
}

/** A short-lived access token. When Google says the permission is gone, the connection is flagged so the page asks to reconnect. */
export async function accessTokenFor(conn: Connection): Promise<string> {
  // Plexo-managed: Plexo's own service account reads the property; there is no owner token.
  if (conn.mode === "managed") return serviceAccessToken();
  if (isGoogleAnalyticsMock()) return "mock-access-token";
  if (!conn.refreshTokenEncrypted) throw new GoogleAuthError("invalid_grant");
  const refresh = decryptGoogleAnalyticsToken(conn.refreshTokenEncrypted);
  try {
    return (await refreshAccessToken(refresh)).accessToken;
  } catch (err) {
    if (err instanceof GoogleAuthError && err.needsReconnect) await markNeedsReconnect(conn.templateId);
    throw err;
  }
}

export async function markNeedsReconnect(templateId: string): Promise<void> {
  await SiteGoogleAnalytics.patch({ templateId }).set({ status: "needs_reconnect" }).go().catch(() => undefined);
  forgetTag(templateId);
}

export function dataClientFor(accessToken: string, mode: "managed" | "own" = "own"): AnalyticsDataClient {
  const mock = mode === "managed" ? isManagedMock() : isGoogleAnalyticsMock();
  return mock ? new MockAnalyticsDataClient() : new GoogleAnalyticsDataClient(accessToken);
}

/**
 * The report for ONE site, read with the property stored on that site's own row. There is deliberately no way to
 * pass a property id in: a site can only ever see the property Plexo (or the owner) attached to it, so one owner can
 * never read another's numbers, however the request is crafted.
 */
export async function reportForSite(conn: Connection, siteId: string, days: RangeDays) {
  if (conn.templateId !== siteId || !conn.propertyName) throw new GoogleApiError(404, "No property for this site");
  if (conn.mode === "managed" && !isOurPropertyName(conn.propertyName)) throw new GoogleApiError(404, "Not a Plexo property");
  return dataClientFor(await accessTokenFor(conn), conn.mode === "managed" ? "managed" : "own").getReport(conn.propertyName, days);
}

export function adminClientFor(accessToken: string): AnalyticsAdminClient {
  return isGoogleAnalyticsMock() ? new MockAnalyticsAdminClient() : new GoogleAnalyticsAdminClient(accessToken);
}

/** The address visitors use, as a full URL. */
export async function siteUrlFor(templateId: string): Promise<string | null> {
  const { data } = await PublishedDomain.query.primary({ templateId }).go({ pages: "all" });
  const live = data.filter((d) => d.active !== false);
  const best = live.find((d) => d.type === "CUSTOM") ?? live[0];
  return best ? `https://${best.domain}` : null;
}

export type ProvisionOutcome =
  | { status: "done"; measurementId: string; propertyName: string }
  /** More than one property: let the owner choose. */
  | { status: "choose"; choices: PropertyChoice[] }
  /** The Google account has no Analytics account yet. */
  | { status: "needs_account" };

async function applyProvisioned(templateId: string, p: { accountName: string; propertyName: string; propertyDisplayName: string; streamName: string; measurementId: string }): Promise<ProvisionOutcome> {
  await SiteGoogleAnalytics.patch({ templateId }).set({ ...p, status: "connected" }).go();
  forgetTag(templateId);
  return { status: "done", measurementId: p.measurementId, propertyName: p.propertyName };
}

/**
 * After sign-in: use the owner's only property, or make one for them. `choice` is a property the owner picked
 * from the list; `createNew` forces a fresh property even when they already have others.
 */
export async function provisionSite(conn: Connection, opts: { choice?: { accountName: string; propertyName: string; propertyDisplayName: string }; createNew?: boolean } = {}): Promise<ProvisionOutcome> {
  const url = await siteUrlFor(conn.templateId);
  if (!url) throw new Error("This site is not published yet, so there is no address to measure.");
  const admin = adminClientFor(await accessTokenFor(conn));
  const siteName = hostOf(url);

  if (opts.choice) {
    const stream = await admin.ensureStream(opts.choice.propertyName, url, siteName);
    return applyProvisioned(conn.templateId, { ...opts.choice, ...stream });
  }
  const properties = opts.createNew ? [] : await admin.listProperties();
  if (properties.length === 1) {
    const p = properties[0];
    const stream = await admin.ensureStream(p.propertyName, url, siteName);
    return applyProvisioned(conn.templateId, { accountName: p.accountName, propertyName: p.propertyName, propertyDisplayName: p.propertyDisplayName, ...stream });
  }
  if (properties.length > 1) return { status: "choose", choices: properties };
  const accounts = await admin.listAccounts();
  if (accounts.length === 0) return { status: "needs_account" };
  const made = await admin.createPropertyWithStream(accounts[0].accountName, url, siteName);
  return applyProvisioned(conn.templateId, made);
}

/** Plexo-managed analytics for a site: Plexo makes the property in its own Google account, no sign-in needed. */
export async function startManaged(site: { id: string; organizationId: string }, userId: string): Promise<{ status: "done"; measurementId: string }> {
  const url = await siteUrlFor(site.id);
  if (!url) throw new Error("This site is not published yet, so there is no address to measure.");
  const existing = await getConnection(site.id);
  if (existing?.mode === "managed" && existing.measurementId && existing.propertyName) {
    // Already set up (maybe a plan that lapsed and came back): just make sure the tag is on and the lapse mark is gone.
    await SiteGoogleAnalytics.patch({ templateId: site.id }).set({ status: "connected" }).remove(["lapsedAt"]).go();
    forgetTag(site.id);
    return { status: "done", measurementId: existing.measurementId };
  }
  // Switching from "my own Google account": let that grant go first.
  if (existing) await disconnect(site.id);
  const made = await createManagedProperty(url);
  await SiteGoogleAnalytics.upsert({
    templateId: site.id,
    organizationId: site.organizationId,
    connectedByUserId: userId,
    mode: "managed",
    status: "connected",
    accountName: made.accountName,
    poolAccountName: made.accountName,
    propertyName: made.propertyName,
    propertyDisplayName: made.propertyDisplayName,
    streamName: made.streamName,
    measurementId: made.measurementId,
  }).go();
  forgetTag(site.id);
  return { status: "done", measurementId: made.measurementId };
}

/**
 * Stops measuring a site. A Plexo-managed property goes to Google's trash (Google keeps it 35 days), unless the owner
 * was handed it, in which case it stays theirs. An owner's own Google grant is revoked.
 */
export async function disconnect(templateId: string): Promise<void> {
  const conn = await getConnection(templateId);
  if (!conn) return;
  if (conn.mode === "managed") {
    if (conn.propertyName && !conn.handedOverTo) await deleteManagedProperty(conn.propertyName);
  } else if (!isGoogleAnalyticsMock() && conn.refreshTokenEncrypted) {
    const token = (() => {
      try {
        return decryptGoogleAnalyticsToken(conn.refreshTokenEncrypted!);
      } catch {
        return null;
      }
    })();
    if (token) await revokeToken(token);
  }
  await SiteGoogleAnalytics.delete({ templateId }).go();
  forgetTag(templateId);
}

// The tag lookup runs on every page view of every published site, so it is remembered for a minute per server.
const TAG_TTL_MS = 60_000;
export type SiteTag = { measurementId: string; consent: ConsentSettings };
const tagCache = new Map<string, { tag: SiteTag | null; at: number }>();

export function forgetTag(templateId: string): void {
  tagCache.delete(templateId);
}

/**
 * What to put on this site's pages, or null: not connected, still choosing, needs reconnect, or the owner's plan no
 * longer includes Google Analytics (then the tag simply stops; the connection is kept and comes back when they pay again).
 */
export async function tagForSite(templateId: string): Promise<SiteTag | null> {
  const hit = tagCache.get(templateId);
  if (hit && Date.now() - hit.at < TAG_TTL_MS) return hit.tag;
  let tag: SiteTag | null = null;
  try {
    const conn = await getConnection(templateId);
    if (conn?.status === "connected" && conn.measurementId && (await organizationHasAnalyticsPlan(conn.organizationId))) {
      tag = { measurementId: conn.measurementId, consent: await loadConsentSettings(templateId).catch(() => DEFAULT_CONSENT) };
    }
  } catch {
    // A lookup failure must never break a visitor's page; try again next time.
    return null;
  }
  tagCache.set(templateId, { tag, at: Date.now() });
  return tag;
}

/** Kept for callers that only need the ID. */
export async function measurementIdForSite(templateId: string): Promise<string | null> {
  return (await tagForSite(templateId))?.measurementId ?? null;
}

export { GoogleApiError };
