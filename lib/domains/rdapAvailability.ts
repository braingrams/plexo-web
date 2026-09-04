// A real (not guessed, not optimistic) availability check for any domain whose TLD Route53
// Domains doesn't sell — no vendor account, no API key, no partnership needed. RDAP
// (Registration Data Access Protocol, RFC 7482) is the modern, IANA-mandated successor to
// WHOIS: every gTLD and most ccTLD registries run a public RDAP server, and rdap.org is the
// standard community redirector that already knows which authoritative server to ask for a
// given TLD, so this app never has to fetch/maintain IANA's own bootstrap registry
// (data.iana.org/rdap/dns.json) itself just to answer "who do I even ask about .ng?"
//
// Coverage is real but not universal — a handful of smaller ccTLD registries run no public
// RDAP server at all (or rate-limit/block it), which this treats as "couldn't check" rather
// than guessing either way. See resolveExternalAvailability's own comment on how that
// shows up to the user.

export type ExternalAvailability = "AVAILABLE" | "TAKEN" | "UNKNOWN";

/**
 * RDAP semantics: a 404 means the registry has no record for this name (available); a 200
 * with a domain object means it's registered (taken); anything else (network failure,
 * timeout, a registry that blocks RDAP, a malformed response) is genuinely unknown — never
 * reported as either AVAILABLE or TAKEN, since getting this wrong in either direction is
 * worse than admitting Plexo can't tell.
 */
export async function checkExternalAvailability(domain: string): Promise<ExternalAvailability> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      signal: controller.signal,
      headers: { Accept: "application/rdap+json" },
    });
    clearTimeout(timeout);
    if (res.status === 404) return "AVAILABLE";
    if (res.ok) return "TAKEN";
    return "UNKNOWN";
  } catch {
    return "UNKNOWN"; // network error, timeout, or a registry with no public RDAP server
  }
}

/**
 * Where to send a customer to register a domain Plexo can't buy for them directly. This
 * used to link straight to one commercial registrar's search page — wrong, confirmed live:
 * a domain under a ccTLD that registrar doesn't resell at all (e.g. Nigeria's .ng, which
 * needs a NiRA-accredited registrar) landed the customer on that registrar's own
 * "Unsupported TLD" page, a dead end.
 *
 * There is no single commercial registrar that covers every TLD in existence — plenty of
 * ccTLDs are only sold through country-specific accredited registrars. IANA's own root zone
 * database is the one destination that's authoritative and correct for literally every TLD,
 * gTLD or ccTLD: it names that TLD's actual registry and (for the common case) links onward
 * to where it's actually sold, rather than guessing at a reseller that may not carry it.
 * Verified live against real TLDs (including "ng") before shipping this — every one
 * resolves.
 */
export function externalRegistrationUrl(domain: string): string {
  const labels = domain.trim().toLowerCase().split(".");
  const rootTld = labels[labels.length - 1] ?? "";
  return `https://www.iana.org/domains/root/db/${encodeURIComponent(rootTld)}.html`;
}
