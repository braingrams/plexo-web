import { prisma } from "@/server/prisma";
import { extractOutboundUrls } from "@/server/rawUpload";

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
 * Fire-and-forget by design: callers should `void scanPublishedDomain(id).catch(...)`
 * rather than await this in the request path that publishes/links a domain.
 */
export async function scanPublishedDomain(publishedDomainId: string): Promise<void> {
  const record = await prisma.publishedDomain.findUnique({
    where: { id: publishedDomainId },
    include: { template: { select: { compiledHtml: true } } },
  });
  if (!record) return;

  const outbound = extractOutboundUrls(record.template.compiledHtml);
  const urlsToCheck = [`https://${record.domain}/`, ...outbound];

  try {
    const matches = await checkUrlsForThreats(urlsToCheck);
    await prisma.publishedDomain.update({
      where: { id: record.id },
      data: {
        lastScannedAt: new Date(),
        flagged: matches.length > 0,
        flagReason: matches.length > 0
          ? matches.map((m) => `${m.threatType}: ${m.url}`).join("; ").slice(0, 500)
          : null,
      },
    });
  } catch (err) {
    console.error(`Safe Browsing scan failed for domain ${record.domain}:`, err);
  }
}
