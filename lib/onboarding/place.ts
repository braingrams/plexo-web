/**
 * Where the site owner is, as well as we can tell, so SOL's suggestions (a city, a phone format, a currency)
 * make sense to them instead of showing a sample from another country. Pure and browser-safe.
 */

export type PlaceHints = {
  /** The browser's IANA time zone ("Africa/Lagos"): the most reliable hint we get from the owner's own device. */
  timeZone?: string;
  /** The browser's language and region ("en-NG"): a weaker hint (a Nigerian can use a US-English browser). */
  locale?: string;
  /** From the network edge when it is available (the owner's actual city / country). */
  city?: string;
  country?: string;
};

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[^\p{L}\p{N} _/.,'()+-]/gu, "").trim().slice(0, max) : "");

/** The owner's place as one plain sentence fragment for SOL ("Lagos, Nigeria", or "time zone Africa/Lagos"), or undefined when nothing is known. */
export function describePlace(h: PlaceHints): string | undefined {
  const city = clean(h.city, 60);
  const country = clean(h.country, 60);
  if (city && country) return `${city}, ${country}`;
  if (country) return country;
  const tz = clean(h.timeZone, 60);
  const region = /-([A-Za-z]{2})\b/.exec(clean(h.locale, 20))?.[1]?.toUpperCase();
  const parts = [tz ? `time zone ${tz}` : "", region ? `browser region ${region}` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/** What this browser can tell us about where its owner is (client only). */
export function browserPlace(): { timeZone?: string; locale?: string } {
  try {
    return { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: typeof navigator !== "undefined" ? navigator.language : undefined };
  } catch {
    return {};
  }
}
