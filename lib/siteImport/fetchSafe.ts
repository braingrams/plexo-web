import dns from "node:dns";
import ipaddr from "ipaddr.js";

// fetch() has no concept of "don't let this request reach my own infrastructure" — a bare
// fetch(userSuppliedUrl) will happily connect to 169.254.169.254 (the cloud metadata endpoint
// on every major provider), 127.0.0.1, or an internal 10.x/192.168.x service if the URL (or a
// redirect it issues) points there. Every site-import fetch is driven by a URL either typed in
// by the importing user or harvested from the crawled site's own HTML, so this file is the one
// place that boundary gets enforced before any of that ever reaches Node's real fetch().

export class SsrfBlockedError extends Error {
  constructor(
    public readonly url: string,
    reason: string,
  ) {
    super(`Blocked outbound request to ${url}: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

export interface SafeFetchOptions extends RequestInit {
  /** Max redirect hops to follow, each independently re-checked. Default 5. */
  maxRedirects?: number;
}

const DEFAULT_MAX_REDIRECTS = 5;

function isBlockedAddress(address: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(address); // normalizes IPv4-mapped IPv6 (::ffff:10.0.0.1) too
  } catch {
    return true; // unparseable address -> refuse rather than guess
  }
  const range = addr.range();
  // ipaddr.js's own range() already buckets loopback/private/linkLocal/uniqueLocal/etc.
  // "unicast" is the only range that isn't inherently suspicious; multicast/reserved/etc.
  // (broadcast, reserved, benchmarking, amt, as112, ...) have no business being an outbound
  // fetch target either, so this only allows the single expected-good bucket rather than
  // trying to enumerate every bad one.
  return range !== "unicast";
}

async function assertPublicHost(hostname: string): Promise<void> {
  // A literal IP in the URL skips DNS entirely.
  if (ipaddr.isValid(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new SsrfBlockedError(hostname, `resolves to a non-public address (${hostname})`);
    }
    return;
  }
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new SsrfBlockedError(hostname, `DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(hostname, "DNS lookup returned no addresses");
  }
  // Check every resolved address, not just the first — a round-robin/multi-A-record host
  // could have a mix of public and internal addresses, and checking only one is a bypass.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new SsrfBlockedError(hostname, `resolves to a non-public address (${address})`);
    }
  }
}

/**
 * fetch() with SSRF protection: resolves the hostname via DNS before connecting and rejects
 * private/loopback/link-local/multicast/reserved ranges (this is what keeps a crawl from ever
 * reaching a cloud metadata endpoint or internal service) — re-validated on every redirect hop,
 * since a public host's 3xx can point anywhere and fetch's own redirect:"follow" gives no hook
 * to inspect intermediate hops before they're connected to.
 *
 * Known gap, accepted for v1: this checks-then-connects rather than pinning the checked address
 * for the actual connection, so a host that resolves safely at check-time and rebinds to an
 * internal address by connect-time (DNS rebinding) isn't fully closed. Site-import's fetches are
 * one-shot crawl requests rather than a sustained, repeatedly-hit public API, which makes this an
 * acceptable v1 tradeoff rather than a blocker — closing it fully would mean pinning the resolved
 * address onto the actual socket (a custom undici Agent `connect` override), left as a follow-up.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { maxRedirects = DEFAULT_MAX_REDIRECTS, ...init } = opts;
  let currentUrl = url;
  let redirectsLeft = maxRedirects;

  for (;;) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new SsrfBlockedError(currentUrl, "not a valid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SsrfBlockedError(currentUrl, `unsupported scheme "${parsed.protocol}"`);
    }
    await assertPublicHost(parsed.hostname);

    const res = await fetch(currentUrl, { ...init, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res; // redirect status with no Location header - nothing to follow
      if (redirectsLeft <= 0) {
        throw new SsrfBlockedError(currentUrl, "too many redirects");
      }
      currentUrl = new URL(location, currentUrl).toString();
      redirectsLeft -= 1;
      continue;
    }

    return res;
  }
}
