/**
 * Where a cookie notice is required before analytics may run. Decided on the server from the visitor's country, which
 * the edge puts in a request header. Everywhere else no notice is shown and nothing changes for the visitor.
 *
 * Covered: the European Economic Area (EU + Iceland, Liechtenstein, Norway), the United Kingdom, Switzerland and Brazil.
 * To add a country, add its two-letter code here; this is the only list.
 */
export const CONSENT_COUNTRIES: ReadonlySet<string> = new Set([
  // European Union
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // Rest of the EEA
  "IS", "LI", "NO",
  // UK and Switzerland have their own laws with the same rule
  "GB", "CH",
  // Brazil (LGPD)
  "BR",
]);

/** The visitor's two-letter country code from edge headers (CloudFront, Vercel previews, Cloudflare), or null. */
export function visitorCountry(headers: Pick<Headers, "get">): string | null {
  const dev = process.env.NODE_ENV !== "production" ? process.env.CONSENT_DEV_COUNTRY : undefined;
  const raw = headers.get("cloudfront-viewer-country") ?? headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry") ?? dev ?? null;
  const code = raw?.trim().toUpperCase() ?? "";
  // "XX" and "T1" are how edges say "unknown" and "Tor".
  return /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}

/**
 * True when this visitor must be asked first. When the country is unknown the answer is yes: asking someone who did
 * not need to be asked costs a click, while not asking someone who did is the one mistake that matters.
 */
export function consentRequiredFor(country: string | null): boolean {
  if (!country) return true;
  return CONSENT_COUNTRIES.has(country.toUpperCase());
}
