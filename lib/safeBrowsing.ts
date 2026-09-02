import { extractOutboundUrls } from "@/server/rawUpload";
import { PublishedDomain, Template } from "@/lib/db/contentEntities";

// Google Safe Browsing v4 lookup — free tier, no billing required for this quota.
// https://developers.google.com/safe-browsing/v4/lookup-api
// Get a key: Google Cloud Console -> APIs & Services -> enable "Safe Browsing API" ->
// Credentials -> API key. Set GOOGLE_SAFE_BROWSING_API_KEY.
const SAFE_BROWSING_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";

export type ThreatMatch = { url: string; threatType: string };

/**
 * Checks a batch of URLs against Google's threat lists. No-ops (returns []) if the API
 * key isn't configured, so this is safe to call from every environment including local
 * dev without failing the request that triggered it.
 */
export async function checkUrlsForThreats(urls: string[]): Promise<ThreatMatch[]> {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey || urls.length === 0) return [];

  const body = {
    client: { clientId: "plexo", clientVersion: "1.0.0" },
    threatInfo: {
      threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: urls.map((url) => ({ url })),
    },
  };

  const res = await fetch(`${SAFE_BROWSING_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("Safe Browsing lookup failed:", res.status, await res.text().catch(() => ""));
    return [];
  }

  const data = await res.json().catch(() => ({}));
  const matches = Array.isArray(data.matches) ? data.matches : [];
  return matches.map((m: any) => ({
    url: m.threat?.url ?? "unknown",
    threatType: m.threatType ?? "UNKNOWN",
  }));
}

/**
 * Scans a single published domain's live URL plus every outbound link referenced in its
 * page content, and persists the result. Deliberately does NOT auto-suspend on a hit —
 * flags it for human review instead, since a false positive taking down a legitimate
 * tenant's page unattended is worse than a short review delay. Call
 * app/api/internal/domains/[id]/suspend to act on a flagged domain.
 *
 * Fire-and-forget by design: callers should `void scanPublishedDomain(templateId, id).catch(...)`
 * rather than await this in the request path that publishes/links a domain.
 *
 * Takes (templateId, id) rather than a bare id — PublishedDomain's real DynamoDB key is
 * (templateId, id) (templateId is part of the entity's own primary key composite, see
 * contentEntities.ts), so a lookup by id alone has no index to serve it.
 */
export async function scanPublishedDomain(templateId: string, id: string): Promise<void> {
  const { data: record } = await PublishedDomain.get({ templateId, id }).go();
  if (!record) return;
  const { data: template } = await Template.get({ id: record.templateId }).go();
  if (!template) return;

  const outbound = extractOutboundUrls(template.compiledHtml);
  const urlsToCheck = [`https://${record.domain}/`, ...outbound];

  try {
    const matches = await checkUrlsForThreats(urlsToCheck);
    const flagged = matches.length > 0;
    // .set() with `undefined` is treated as "not provided" (no-op), not "clear" — an
    // unflag (matches.length back to 0) needs an explicit .remove() to actually drop the
    // stale flagReason, not just leave the previous scan's reason sitting there.
    let query = PublishedDomain.patch({ templateId, id }).set({ lastScannedAt: new Date().toISOString(), flagged });
    query = flagged
      ? query.set({ flagReason: matches.map((m) => `${m.threatType}: ${m.url}`).join("; ").slice(0, 500) })
      : query.remove(["flagReason"]);
    await query.go();
  } catch (err) {
    console.error(`Safe Browsing scan failed for domain ${record.domain}:`, err);
  }
}
